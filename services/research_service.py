import json
import os
import requests

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

TAVILY_URL = "https://api.tavily.com/search"


def _model():
    return ChatGoogleGenerativeAI(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        temperature=0.2,
    )


def make_search_queries(question):
    prompt = f"""
Create 3 useful web search queries for this research question:

{question}

Return only a JSON array of 3 strings.
""".strip()

    response = _model().invoke([HumanMessage(content=prompt)])
    text = response.content.strip()

    try:
        queries = json.loads(text)
        if isinstance(queries, list):
            return [str(q) for q in queries[:3]]
    except json.JSONDecodeError:
        pass

    return [question]


def search_web(query, max_results=5):
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return []

    response = requests.post(
        TAVILY_URL,
        headers={"Content-Type": "application/json"},
        json={
            "api_key": api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": max_results,
            "include_answer": False,
        },
        timeout=25,
    )
    response.raise_for_status()

    results = response.json().get("results", [])
    return [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "content": item.get("content", ""),
        }
        for item in results
    ]


def research_question(question):
    if not os.getenv("TAVILY_API_KEY"):
        return {
            "context": "",
            "sources": [],
            "error": "Research mode needs TAVILY_API_KEY in .env.",
        }

    queries = make_search_queries(question)
    seen = set()
    results = []

    for query in queries:
        try:
            for item in search_web(query):
                url = item["url"]
                if url and url not in seen:
                    seen.add(url)
                    results.append(item)
        except requests.RequestException:
            continue

    context_parts = []
    for index, item in enumerate(results[:12], start=1):
        context_parts.append(
            f"[Web Source {index}]\n"
            f"Title: {item['title']}\n"
            f"URL: {item['url']}\n"
            f"Content: {item['content']}"
        )

    return {
        "context": "\n\n".join(context_parts),
        "sources": results[:12],
        "error": "",
    }
