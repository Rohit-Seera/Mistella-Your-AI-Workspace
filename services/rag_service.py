import hashlib
import os
import pickle
import re
from pathlib import Path

import faiss
import numpy as np
from pypdf import PdfReader
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer


INDEX_DIR = Path("data/index")
INDEX_DIR.mkdir(parents=True, exist_ok=True)


class AdvancedRAG:
    def __init__(self):
        self.embedding_model_name = os.getenv(
            "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )
        self.reranker_model_name = os.getenv(
            "RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2"
        )

        self.embedder = None
        self.reranker = None
        self.chunks = []
        self.bm25 = None
        self.index = None
        self.sources = set()

        self._load_index()

    def _get_embedder(self):
        if self.embedder is None:
            self.embedder = SentenceTransformer(self.embedding_model_name)
        return self.embedder

    def _get_reranker(self):
        if self.reranker is None:
            self.reranker = CrossEncoder(self.reranker_model_name)
        return self.reranker

    def load_pdfs(self, pdf_paths):
        pages = []
        added_sources = []

        for path in pdf_paths:
            source_hash = self._file_hash(path)
            if source_hash in self.sources:
                continue

            reader = PdfReader(path)
            for page_no, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    pages.append(
                        {
                            "text": text,
                            "source": Path(path).name,
                            "page": page_no,
                        }
                    )

            self.sources.add(source_hash)
            added_sources.append(Path(path).name)

        if not pages:
            return 0

        new_chunks = self._make_chunks(pages)
        self.chunks.extend(new_chunks)
        self._build_indexes()
        self._save_index()

        return len(new_chunks)

    def _make_chunks(self, pages, chunk_size=900, overlap=150):
        chunks = []

        for page in pages:
            text = page["text"]
            start = 0

            while start < len(text):
                end = min(start + chunk_size, len(text))
                piece = text[start:end].strip()

                if piece:
                    chunks.append(
                        {
                            "text": piece,
                            "source": page["source"],
                            "page": page["page"],
                        }
                    )

                if end >= len(text):
                    break
                start = end - overlap

        return chunks

    def _build_indexes(self):
        if not self.chunks:
            self.index = None
            self.bm25 = None
            return

        texts = [item["text"] for item in self.chunks]
        vectors = self._get_embedder().encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        ).astype("float32")

        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)

        tokenized = [self._tokenize(text) for text in texts]
        self.bm25 = BM25Okapi(tokenized)

    def retrieve(self, query, top_k=5):
        if not self.ready:
            return []

        candidate_count = min(max(top_k * 4, 12), len(self.chunks))
        query_vector = self._get_embedder().encode(
            [query],
            normalize_embeddings=True,
            show_progress_bar=False,
        ).astype("float32")

        _, vector_ids = self.index.search(query_vector, candidate_count)
        vector_ids = [idx for idx in vector_ids[0].tolist() if idx >= 0]

        bm25_scores = self.bm25.get_scores(self._tokenize(query))
        bm25_ids = np.argsort(bm25_scores)[::-1][:candidate_count].tolist()

        fused_scores = {}

        for rank, idx in enumerate(vector_ids, start=1):
            fused_scores[idx] = fused_scores.get(idx, 0) + 1 / (60 + rank)

        for rank, idx in enumerate(bm25_ids, start=1):
            fused_scores[idx] = fused_scores.get(idx, 0) + 1 / (60 + rank)

        candidate_ids = [
            idx
            for idx, _ in sorted(
                fused_scores.items(), key=lambda item: item[1], reverse=True
            )
        ]
        candidate_ids = candidate_ids[: min(top_k * 2, len(candidate_ids))]

        candidates = [self.chunks[idx].copy() for idx in candidate_ids]
        if len(candidates) > top_k:
            candidates = self._rerank(query, candidates)

        return candidates[:top_k]

    def _rerank(self, query, candidates):
        pairs = [(query, item["text"]) for item in candidates]
        scores = self._get_reranker().predict(pairs)

        ranked = sorted(
            zip(candidates, scores),
            key=lambda pair: float(pair[1]),
            reverse=True,
        )
        return [item for item, _ in ranked]

    def clear(self):
        self.chunks = []
        self.bm25 = None
        self.index = None
        self.sources = set()

        for path in INDEX_DIR.glob("mistella_*"):
            path.unlink(missing_ok=True)

    @staticmethod
    def _tokenize(text):
        return re.findall(r"[a-zA-Z0-9]+", text.lower())

    @staticmethod
    def _file_hash(path):
        digest = hashlib.sha256()
        with open(path, "rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _save_index(self):
        faiss_path = INDEX_DIR / "mistella_faiss.index"
        chunks_path = INDEX_DIR / "mistella_chunks.pkl"

        if self.index is not None:
            faiss.write_index(self.index, str(faiss_path))

        with chunks_path.open("wb") as file:
            pickle.dump(
                {
                    "chunks": self.chunks,
                    "sources": self.sources,
                },
                file,
            )

    def _load_index(self):
        faiss_path = INDEX_DIR / "mistella_faiss.index"
        chunks_path = INDEX_DIR / "mistella_chunks.pkl"

        if not faiss_path.exists() or not chunks_path.exists():
            return

        try:
            self.index = faiss.read_index(str(faiss_path))
            with chunks_path.open("rb") as file:
                data = pickle.load(file)

            self.chunks = data.get("chunks", [])
            self.sources = set(data.get("sources", set()))
            self.bm25 = BM25Okapi(
                [self._tokenize(item["text"]) for item in self.chunks]
            ) if self.chunks else None
        except Exception:
            self.chunks = []
            self.sources = set()
            self.index = None
            self.bm25 = None

    @property
    def ready(self):
        return bool(self.chunks and self.index is not None and self.bm25 is not None)


_rag = None


def get_rag():
    global _rag
    if _rag is None:
        _rag = AdvancedRAG()
    return _rag
