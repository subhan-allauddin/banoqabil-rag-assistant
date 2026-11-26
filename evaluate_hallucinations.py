"""
Systematic hallucination & grounding evaluation for the Bano Qabil RAG assistant.

Runs a curated set of test questions (in-KB, partial/top-k-limited, false-premise,
and out-of-KB traps) against the live Pinecone + Gemini RAG pipeline and saves
the retrieved chunks and generated answers to hallucination_eval_results.json.
"""

import json
from banoqabil_rag import DEFAULT_JSON, format_docs, setup_rag

TEST_CASES = [
    # 1. In-KB factual
    {
        "category": "in_kb_factual",
        "question": "What courses does Bano Qabil offer?",
    },
    {
        "category": "in_kb_factual",
        "question": "Who runs Bano Qabil and what is its fee?",
    },
    {
        "category": "in_kb_factual",
        "question": "Where are Bano Qabil campuses located?",
    },
    # 2. Top-K / chunking truncation traps (KB is large, TOP_K=4)
    {
        "category": "top_k_truncation",
        "question": "List every single instructor on the Bano Qabil faculty.",
    },
    {
        "category": "top_k_truncation",
        "question": "List all 51 pages or every campus address of Bano Qabil.",
    },
    # 3. Sparse / missing detail traps
    {
        "category": "sparse_kb",
        "question": "How do I reset my password on the Bano Qabil student portal?",
    },
    {
        "category": "sparse_kb",
        "question": "What are the exact batch start dates and class timings for 2026?",
    },
    # 4. False-premise / out-of-KB hallucination traps
    {
        "category": "false_premise",
        "question": "What is the monthly stipend Bano Qabil pays to every enrolled student?",
    },
    {
        "category": "false_premise",
        "question": "Tell me about Bano Qabil's partnership with NASA.",
    },
    {
        "category": "out_of_kb",
        "question": "What is Bano Qabil's campus address in London, UK?",
    },
    {
        "category": "out_of_kb",
        "question": "Does Bano Qabil offer a PhD in Quantum Computing?",
    },
    {
        "category": "out_of_kb",
        "question": "What is the phone number for Bano Qabil's student hostel?",
    },
]


def main():
    retriever, chain = setup_rag([DEFAULT_JSON])
    results = []

    for idx, case in enumerate(TEST_CASES, 1):
        q = case["question"]
        print(f"\n[{idx}/{len(TEST_CASES)}] ({case['category']}) {q}")
        docs = retriever.invoke(q)
        context = format_docs(docs)
        answer = chain.invoke({"context": context, "question": q})
        print(f"Answer: {answer[:300]}{'...' if len(answer) > 300 else ''}")
        results.append(
            {
                "category": case["category"],
                "question": q,
                "answer": answer,
                "retrieved_sources": [
                    {
                        "title": d.metadata.get("title", ""),
                        "url": d.metadata.get("source", ""),
                        "preview": d.page_content[:250],
                    }
                    for d in docs
                ],
            }
        )

    with open("hallucination_eval_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print("\nSaved results to hallucination_eval_results.json")


if __name__ == "__main__":
    main()
