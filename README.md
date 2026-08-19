# Mistella — The Intelligent AI

Mistella is an agentic multimodal AI workspace built to combine everyday chat, web research, document question-answering, image understanding, and persistent conversations in one interface.

## What it does

- General conversational chat with streaming responses
- Web research workflow for current information
- PDF upload and retrieval-augmented question answering
- Hybrid retrieval with vector search + BM25 and reranking
- Image uploads for multimodal requests
- Persistent chat threads with titles and deletion
- React frontend backed by FastAPI and LangGraph

## Architecture

```text
React Frontend
      │
      ▼
FastAPI API
      │
      ▼
LangGraph Workflow
 ┌────┼───────────┐
 ▼    ▼           ▼
Chat  RAG      Research
 │    │           │
LLM  FAISS/BM25  Web Search
 │    │           │
 └────┴───────────┘
          │
          ▼
    Persistent state
```

## Tech stack

Python · FastAPI · React · LangChain · LangGraph · FAISS · BM25 · Sentence Transformers · Tavily · Gemini/Groq

## Local setup

Create a local `.env` from `.env.example` and add your API keys.

### Backend

```powershell
uv venv
.venv\Scripts\Activate.ps1
uv pip install -r requirements.txt
uv run python -m uvicorn backend.main:app --reload --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Environment

Never commit `.env`. Use `.env.example` only as the template for required variables.

## Project status

Mistella is under active development. The repository is kept runnable locally while LLM provider support, retrieval quality, UI performance, and deployment are iterated.
