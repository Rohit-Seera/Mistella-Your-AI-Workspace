import os
import re
import sqlite3
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from services.rag_service import get_rag
from services.research_service import research_question

load_dotenv()


class ChatbotState(TypedDict):
    message: Annotated[list[BaseMessage], add_messages]
    context: str
    mode: str
    route: str


llm = ChatGoogleGenerativeAI(
    model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    temperature=0.3,
)

conn = sqlite3.connect("chatbot.db", check_same_thread=False)
checkpointer = SqliteSaver(conn=conn)


conn.execute(
    """
    CREATE TABLE IF NOT EXISTS thread_titles (
        thread_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """
)
conn.commit()


def make_thread_title(message):
    clean = re.sub(r"\s+", " ", message).strip()
    if not clean:
        return "New chat"
    return clean if len(clean) <= 42 else clean[:42].rsplit(" ", 1)[0] + "…"


def ensure_thread_title(thread_id, message):
    row = conn.execute(
        "SELECT title FROM thread_titles WHERE thread_id = ?",
        (thread_id,),
    ).fetchone()

    if row:
        return row[0]

    title = make_thread_title(message)
    conn.execute(
        "INSERT OR REPLACE INTO thread_titles(thread_id, title) VALUES (?, ?)",
        (thread_id, title),
    )
    conn.commit()
    return title


def get_thread_title(thread_id):
    row = conn.execute(
        "SELECT title FROM thread_titles WHERE thread_id = ?",
        (thread_id,),
    ).fetchone()
    return row[0] if row else "New chat"



def get_user_message(messages):
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            if isinstance(message.content, str):
                return message.content
            return " ".join(
                part.get("text", "")
                for part in message.content
                if isinstance(part, dict) and part.get("type") == "text"
            )
    return ""


def format_context(docs):
    if not docs:
        return ""

    parts = []
    for doc in docs:
        parts.append(
            f"[Source: {doc['source']}, page {doc['page']}]\n{doc['text']}"
        )
    return "\n\n".join(parts)


def choose_route(state: ChatbotState):
    mode = state.get("mode", "chat")
    query = get_user_message(state["message"])

    if mode == "documents":
        return {"route": "rag"}

    if mode == "research":
        return {"route": "research"}

    # Normal chat stays normal chat unless the user clearly asks for
    # fresh research/current information.
    research_words = {
        "latest",
        "current",
        "recent",
        "news",
        "today",
        "this week",
        "research online",
        "search the web",
        "on the internet",
        "look online",
        "what is happening",
    }
    query_lower = query.lower()

    if any(word in query_lower for word in research_words):
        return {"route": "research"}

    return {"route": "chat"}


def retrieve_context(state: ChatbotState):
    query = get_user_message(state["message"])
    rag = get_rag()

    if not rag.ready:
        return {"context": ""}

    docs = rag.retrieve(query)
    return {"context": format_context(docs)}


def run_research(state: ChatbotState):
    query = get_user_message(state["message"])
    result = research_question(query)

    if result["error"]:
        return {
            "context": (
                "No web research was performed because the research tool is "
                f"not configured. {result['error']}"
            )
        }

    sources = "\n".join(
        f"{index}. {item['title']} — {item['url']}"
        for index, item in enumerate(result["sources"], start=1)
    )

    return {
        "context": (
            "WEB RESEARCH RESULTS:\n"
            f"{result['context']}\n\n"
            "WEB SOURCES:\n"
            f"{sources}"
        )
    }


def chat(state: ChatbotState):
    route = state.get("route", "chat")
    context = state.get("context", "")

    if route == "rag":
        system_prompt = """
You are Mistella, a practical AI document assistant.

Use the retrieved document context when answering.
Do not invent facts from the documents.
If the documents do not contain enough information, say so clearly.
When you use document evidence, add a short Sources section with source name and page.
For normal questions outside the documents, you may still answer using your general knowledge.
""".strip()

    elif route == "research":
        system_prompt = """
You are Mistella in Research mode.

Use the supplied web research results as evidence.
Synthesize the findings instead of copying search snippets.
Call out uncertainty or disagreement between sources.
Prefer specific, useful answers over generic summaries.
Include a concise Sources section with the URLs used.
Do not claim that you personally browsed anything beyond the supplied results.
""".strip()

    else:
        system_prompt = """
You are Mistella, a friendly and practical general-purpose AI assistant.

Answer the user's question directly using your general knowledge and reasoning.
Do NOT restrict yourself to uploaded documents.
Do NOT say that you only know what is in the user's files.
Use document context only when it is actually provided and relevant.
For coding, web development, study questions, explanations, planning, and everyday questions, answer normally.
""".strip()

    if context:
        system_prompt += f"\n\n{context}"

    response = llm.invoke(
        [SystemMessage(content=system_prompt)] + state["message"]
    )

    return {"message": [response]}


graph = StateGraph(ChatbotState)
graph.add_node("route", choose_route)
graph.add_node("retrieve", retrieve_context)
graph.add_node("research", run_research)
graph.add_node("chat", chat)

graph.add_edge(START, "route")
graph.add_conditional_edges(
    "route",
    lambda state: state["route"],
    {
        "rag": "retrieve",
        "research": "research",
        "chat": "chat",
    },
)
graph.add_edge("retrieve", "chat")
graph.add_edge("research", "chat")
graph.add_edge("chat", END)

workflow = graph.compile(checkpointer=checkpointer)


def reterive_thread():
    all_threads = set()

    for checkpoint in checkpointer.list(None):
        thread_id = checkpoint.config["configurable"].get("thread_id")
        if thread_id:
            all_threads.add(thread_id)

    rows = []
    for thread_id in all_threads:
        rows.append(
            {
                "id": thread_id,
                "title": get_thread_title(thread_id),
            }
        )

    return sorted(rows, key=lambda item: item["title"].lower())


def get_conversation(thread_id):
    state = workflow.get_state(
        config={"configurable": {"thread_id": thread_id}}
    )
    return state.values.get("message", [])


def delete_thread(thread_id):
    for table in ["checkpoints", "writes"]:
        try:
            conn.execute(
                f"DELETE FROM {table} WHERE thread_id = ?",
                (thread_id,),
            )
        except sqlite3.OperationalError:
            pass

    conn.execute(
        "DELETE FROM thread_titles WHERE thread_id = ?",
        (thread_id,),
    )
    conn.commit()
