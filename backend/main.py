import json
import os
import shutil
import base64
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db_backend import delete_thread, ensure_thread_title, get_conversation, reterive_thread, workflow
from langchain_core.messages import HumanMessage
from services.rag_service import get_rag

UPLOAD_DIR = Path("data/uploads")
MEDIA_DIR = Path("data/media")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Mistella API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    thread_id: str
    message: str
    mode: str = "chat"
    media_paths: list[str] = []


def message_to_dict(message):
    content = getattr(message, "content", "")
    role = "assistant" if message.__class__.__name__ == "AIMessage" else "user"
    return {"role": role, "content": content}


@app.get("/api/health")
def health():
    rag = get_rag()
    return {
        "status": "ok",
        "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "rag_ready": rag.ready,
        "chunks": len(rag.chunks),
    }


@app.get("/api/threads")
def threads():
    return {"threads": reterive_thread()}


@app.delete("/api/threads/{thread_id}")
def remove_thread(thread_id: str):
    delete_thread(thread_id)
    return {"status": "deleted", "thread_id": thread_id}


@app.get("/api/threads/{thread_id}")
def thread(thread_id: str):
    try:
        messages = get_conversation(thread_id)
    except Exception:
        messages = []

    return {
        "thread_id": thread_id,
        "messages": [message_to_dict(message) for message in messages],
    }



def build_user_content(message: str, media_paths: list[str]):
    if not media_paths:
        return message

    content = [{"type": "text", "text": message}]

    for path in media_paths[:4]:
        file_path = Path(path)

        if not file_path.exists():
            continue

        suffix = file_path.suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue

        mime = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }[suffix]

        encoded = base64.b64encode(file_path.read_bytes()).decode("utf-8")
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime};base64,{encoded}"
                },
            }
        )

    return content


@app.post("/api/chat")
def chat(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    ensure_thread_title(request.thread_id, request.message)

    try:
        result = workflow.invoke(
            {
                "message": [
                    HumanMessage(
                        content=build_user_content(
                            request.message,
                            request.media_paths,
                        )
                    )
                ],
                "context": "",
                "mode": request.mode,
            },
            config=config,
        )
        messages = result.get("message", [])
        answer = messages[-1].content if messages else ""
        return {"thread_id": request.thread_id, "answer": answer}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    ensure_thread_title(request.thread_id, request.message)

    def generate():
        try:
            for chunk, _metadata in workflow.stream(
                {
                    "message": [
                    HumanMessage(
                        content=build_user_content(
                            request.message,
                            request.media_paths,
                        )
                    )
                ],
                    "context": "",
                    "mode": request.mode,
                },
                config=config,
                stream_mode="messages",
            ):
                content = getattr(chunk, "content", "")
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"

            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



@app.post("/api/media/upload")
async def upload_media(files: list[UploadFile] = File(...)):
    saved = []

    allowed = {
        "image/png",
        "image/jpeg",
        "image/webp",
    }

    for file in files:
        if not file.filename or file.content_type not in allowed:
            continue

        safe_name = Path(file.filename).name
        target = MEDIA_DIR / f"{uuid.uuid4().hex[:8]}_{safe_name}"

        with target.open("wb") as output:
            shutil.copyfileobj(file.file, output)

        saved.append(str(target))

    if not saved:
        raise HTTPException(
            status_code=400,
            detail="Please upload PNG, JPG, JPEG, or WEBP images.",
        )

    return {
        "files": [Path(path).name for path in saved],
        "paths": saved,
    }


@app.post("/api/documents/upload")
async def upload_documents(files: list[UploadFile] = File(...)):
    saved = []

    for file in files:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            continue

        safe_name = Path(file.filename).name
        target = UPLOAD_DIR / f"{uuid.uuid4().hex[:8]}_{safe_name}"

        with target.open("wb") as output:
            shutil.copyfileobj(file.file, output)

        saved.append(str(target))

    if not saved:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF.")

    return {"files": [Path(path).name for path in saved], "paths": saved}


class IndexRequest(BaseModel):
    paths: list[str]


@app.post("/api/documents/index")
def index_documents(request: IndexRequest):
    valid_paths = [
        path
        for path in request.paths
        if Path(path).exists() and Path(path).suffix.lower() == ".pdf"
    ]

    if not valid_paths:
        raise HTTPException(status_code=400, detail="No valid PDFs found.")

    try:
        added = get_rag().load_pdfs(valid_paths)
        return {
            "added_chunks": added,
            "total_chunks": len(get_rag().chunks),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/documents")
def documents():
    rag = get_rag()
    grouped = {}

    for item in rag.chunks:
        source = item.get("source", "unknown")
        grouped.setdefault(source, {"name": source, "chunks": 0, "pages": set()})
        grouped[source]["chunks"] += 1
        if item.get("page") is not None:
            grouped[source]["pages"].add(item["page"])

    docs = []
    for item in grouped.values():
        docs.append(
            {
                "name": item["name"],
                "chunks": item["chunks"],
                "pages": len(item["pages"]),
            }
        )

    return {
        "ready": rag.ready,
        "chunks": len(rag.chunks),
        "documents": sorted(docs, key=lambda x: x["name"].lower()),
    }


@app.post("/api/documents/clear")
def clear_documents():
    get_rag().clear()
    return {"status": "cleared"}
