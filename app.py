"""
Web UI server for the Bano Qabil RAG Assistant.

Zero-dependency HTTP server (Python stdlib ThreadingHTTPServer + SSE streaming)
that reuses the Pinecone + Gemini/Groq RAG pipeline from banoqabil_rag.py.

Usage:
    .venv/bin/python app.py
"""

import json
import mimetypes
import os
import sys
import threading
import typing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

# Compatibility shim for pydantic==1.10.8 on Python 3.12.4+ (e.g. Vercel runtime)
if sys.version_info >= (3, 12, 4):
    _orig_forward_ref_evaluate = typing.ForwardRef._evaluate

    def _patched_forward_ref_evaluate(self, globalns, localns, *args, **kwargs):
        if args and "recursive_guard" not in kwargs and isinstance(args[-1], (set, frozenset)):
            kwargs["recursive_guard"] = args[-1]
            args = args[:-1]
        return _orig_forward_ref_evaluate(self, globalns, localns, *args, **kwargs)

    typing.ForwardRef._evaluate = _patched_forward_ref_evaluate

from dotenv import load_dotenv
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda
from langchain_pinecone import PineconeVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone import Pinecone

import banoqabil_rag as rag

HOST = os.getenv("APP_HOST", "127.0.0.1")
PORT = int(os.getenv("APP_PORT", "8000"))
STATIC_DIR = Path(__file__).resolve().parent / "static"

LANGUAGE_HINTS = {
    "en": "Respond in English.",
    "roman": "Respond in Roman Urdu (Urdu written in Latin script).",
    "ur": "Respond in Urdu script (اردو).",
}

WEB_PROMPT_TEMPLATE = """
You are the assistant for the Bano Qabil website (a free IT training program by Alkhidmat
Foundation Pakistan). You are a Multi-Lingual Assistant. Give the answer in the language of
the question.
Answer the question based ONLY on the context below. If you can't
answer the question from the context, reply "I don't know".

Format your answer clearly and concisely using Markdown:
- Start with a direct 1-2 line summary.
- Use short section headings (###) and bullet points (-) when listing multiple items (such as courses, campuses, eligibility, or steps).
- Bold (**...**) key facts like fees, deposits, or program names.
- Do not invent any details not present in the context.

Context: {context}

Question: {question}
"""


class RagState:
    """Holds the initialized Pinecone index, retriever, LLM chain, and KB metadata."""

    def __init__(self):
        self.lock = threading.Lock()
        self.kb_file = rag.DEFAULT_JSON
        self.page_count = 0
        self.chunk_count = 0
        self.namespace = ""
        self.vector_count = 0
        self.index_name = rag.PINECONE_INDEX_NAME
        self.llm_label = "Not initialized"
        self.ready = False
        self.error = None
        self._background_init = False

        self._pc = None
        self._index = None
        self._embeddings = None
        self._chunks = []
        self._vectorstore = None
        self._retriever = None
        self._chain = None

    def initialize(self):
        """Load env, read KB JSON, ensure Pinecone index & embeddings, and build LLM chain."""
        load_dotenv()

        llm_key = os.getenv("OPENAI_API_KEY") or os.getenv("GROQ_API_KEY")
        gemini_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        pinecone_key = os.getenv("PINECONE_API_KEY")

        missing = []
        if not gemini_key:
            missing.append("GOOGLE_API_KEY (or GEMINI_API_KEY)")
        if not pinecone_key:
            missing.append("PINECONE_API_KEY")
        if missing:
            raise RuntimeError("Missing in .env: " + ", ".join(missing))

        json_paths = rag.resolve_json_paths([self.kb_file])
        if not json_paths:
            raise RuntimeError(f"Knowledge base file not found: {self.kb_file}")

        documents = rag.load_json_files(json_paths)
        if not documents:
            raise RuntimeError(f"No usable text found in {self.kb_file}")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=rag.CHUNK_SIZE,
            chunk_overlap=rag.CHUNK_OVERLAP,
        )
        self._chunks = splitter.split_documents(documents)
        self.page_count = len(documents)
        self.chunk_count = len(self._chunks)
        self.namespace = f"web-{rag.fingerprint(json_paths)}"

        self._embeddings = rag.PlainListEmbeddings(
            model=rag.EMBEDDING_MODEL,
            google_api_key=gemini_key,
        )
        self._pc = Pinecone(api_key=pinecone_key)
        if self.index_name in self._pc.list_indexes().names():
            dimension = self._pc.describe_index(self.index_name).dimension
        else:
            dimension = len(self._embeddings.embed_query("dimension probe"))

        self._index = rag.ensure_index(self._pc, dimension)
        self._vectorstore = PineconeVectorStore(
            index=self._index,
            embedding=self._embeddings,
            namespace=self.namespace,
        )

        already = rag.namespace_vector_count(self._index, self.namespace)
        if already < len(self._chunks):
            ids = [f"{self.namespace}-{i}" for i in range(len(self._chunks))]
            rag.upload_chunks(self._vectorstore, self._chunks, ids, offset=already)
            rag.wait_until_searchable(self._index, self.namespace, len(self._chunks))

        self.vector_count = rag.namespace_vector_count(self._index, self.namespace)

        model = rag.build_llm(llm_key, gemini_key)
        self.llm_label = getattr(model, "model_name", None) or getattr(model, "model", "LLM")
        prompt = ChatPromptTemplate.from_template(WEB_PROMPT_TEMPLATE)
        self._chain = prompt | model | RunnableLambda(rag.extract_text)
        self._retriever = self._vectorstore.as_retriever(search_kwargs={"k": rag.TOP_K})
        self.ready = True

    def ensure_initialized(self):
        """Thread-safe lazy initialization for serverless environments (e.g. Vercel)."""
        if self.ready or self.error:
            return
        with self.lock:
            if self.ready or self.error:
                return
            try:
                self.initialize()
            except Exception as exc:
                self.error = f"{type(exc).__name__}: {exc}"

    def status_dict(self):
        return {
            "ready": self.ready,
            "error": self.error,
            "kb_file": self.kb_file,
            "page_count": self.page_count,
            "chunk_count": self.chunk_count,
            "index_name": self.index_name,
            "namespace": self.namespace,
            "vector_count": self.vector_count,
            "llm_model": self.llm_label,
        }

    def reindex(self):
        """Delete the current namespace vectors and re-upload all chunks."""
        with self.lock:
            if not self.ready:
                raise RuntimeError("RAG pipeline is not initialized.")
            try:
                self._index.delete(delete_all=True, namespace=self.namespace)
            except Exception:
                # Namespace may already be empty
                pass
            ids = [f"{self.namespace}-{i}" for i in range(len(self._chunks))]
            rag.upload_chunks(self._vectorstore, self._chunks, ids, offset=0)
            rag.wait_until_searchable(self._index, self.namespace, len(self._chunks))
            self.vector_count = rag.namespace_vector_count(self._index, self.namespace)
            return self.status_dict()

    def retrieve_and_stream(self, question, language="auto"):
        """Return (docs, token_generator) for a user question."""
        if not self.ready:
            raise RuntimeError("RAG pipeline is not initialized.")
        docs = self._retriever.invoke(question)
        hint = LANGUAGE_HINTS.get(language)
        effective_question = f"{question}\n\n[Language instruction: {hint}]" if hint else question
        stream = self._chain.stream(
            {"context": rag.format_docs(docs), "question": effective_question}
        )
        return docs, stream


STATE = RagState()


def serialize_sources(docs):
    """Deduplicate retrieved documents by URL while keeping snippet previews."""
    seen = set()
    sources = []
    for doc in docs:
        url = doc.metadata.get("source") or ""
        title = doc.metadata.get("title") or "Bano Qabil Page"
        snippet = doc.page_content.strip()
        if url in seen:
            continue
        seen.add(url)
        sources.append({"title": title, "url": url, "snippet": snippet})
    return sources


class handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # Keep terminal output clean and readable
        sys.stderr.write(f"[http] {self.address_string()} - {format % args}\n")

    def _send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _serve_file(self, file_path):
        resolved = file_path.resolve()
        if not resolved.is_file() or STATIC_DIR not in resolved.parents:
            self.send_error(404, "Not found")
            return
        mime_type, _ = mimetypes.guess_type(str(resolved))
        content_type = mime_type or "application/octet-stream"
        if content_type.startswith("text/") or content_type == "application/javascript":
            content_type += "; charset=utf-8"
        data = resolved.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/":
            self._serve_file(STATIC_DIR / "index.html")
            return

        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            self._serve_file(STATIC_DIR / rel)
            return

        if path == "/api/status":
            if not STATE.ready and not STATE.error and not STATE._background_init:
                STATE.ensure_initialized()
            self._send_json(200, STATE.status_dict())
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/reindex":
            try:
                STATE.ensure_initialized()
                status = STATE.reindex()
                self._send_json(200, status)
            except Exception as exc:
                self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})
            return

        if path == "/api/chat":
            try:
                body = self._read_json_body()
            except Exception:
                self._send_json(400, {"error": "Invalid JSON body"})
                return

            question = (body.get("question") or "").strip()
            language = (body.get("language") or "auto").strip()
            if not question:
                self._send_json(400, {"error": "Question is required"})
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()

            def send_sse(event_name, data_obj):
                payload = f"event: {event_name}\ndata: {json.dumps(data_obj, ensure_ascii=False)}\n\n"
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()

            try:
                STATE.ensure_initialized()
                docs, stream = STATE.retrieve_and_stream(question, language=language)
                full_answer = []
                for piece in stream:
                    if not piece:
                        continue
                    full_answer.append(piece)
                    send_sse("token", {"text": piece})

                joined = "".join(full_answer).strip()
                is_unknown = (not joined) or joined.lower().startswith("i don't know")
                sources = [] if is_unknown else serialize_sources(docs)
                send_sse("done", {"sources": sources, "is_unknown": is_unknown})
            except (BrokenPipeError, ConnectionResetError):
                # Client aborted stream
                pass
            except Exception as exc:
                try:
                    send_sse("error", {"error": f"{type(exc).__name__}: {exc}"})
                except Exception:
                    pass
            return

        self.send_error(404, "Not found")


# Backwards-compatible alias
RagRequestHandler = handler


def _init_worker():
    try:
        STATE.initialize()
        print(
            f"Ready: {STATE.page_count} pages, {STATE.chunk_count} chunks, "
            f"{STATE.vector_count} vectors in '{STATE.index_name}' ({STATE.namespace}).",
            flush=True,
        )
    except Exception as exc:
        STATE.error = f"{type(exc).__name__}: {exc}"
        print(f"[warning] Initialization failed: {STATE.error}", flush=True)


def main():
    print("Initializing Bano Qabil RAG pipeline in background...", flush=True)
    STATE._background_init = True
    threading.Thread(target=_init_worker, daemon=True).start()

    server = ThreadingHTTPServer((HOST, PORT), handler)
    print(f"Serving Web UI at http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
