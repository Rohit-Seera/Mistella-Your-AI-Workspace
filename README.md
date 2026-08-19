# Mistella — The Intelligent AI

An agentic multimodal AI workspace with LangGraph, hybrid RAG, web research, document Q&A, image understanding, and persistent conversations.

## Stack

Python · FastAPI · React · LangGraph · LangChain · Gemini/Groq · FAISS · BM25 · Tavily

## Run

Backend:
```bash
uv run python -m uvicorn backend.main:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

Create a local `.env` from `.env.example` and add your API keys.
