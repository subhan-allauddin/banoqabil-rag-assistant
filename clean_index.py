
# this file will clean the pincone index

"""
Clean (reset) your Pinecone index.

Usage:
    python clean_index.py                     # delete ALL vectors in ALL namespaces (index is kept)
    python clean_index.py --namespace web-abc # delete only one namespace
    python clean_index.py --drop-index        # delete the whole index (json_rag.py re-creates it)
    python clean_index.py --yes               # skip the confirmation question

Required in your .env file:
    PINECONE_API_KEY=...
"""

import argparse
import os
import sys

from dotenv import load_dotenv
from pinecone import Pinecone

PINECONE_INDEX_NAME = "banoqabil-rag-index"  # must match the name used in banoqabil_rag.py


def main():
    parser = argparse.ArgumentParser(description="Clean a Pinecone index.")
    parser.add_argument("--index", default=PINECONE_INDEX_NAME, help="index name")
    parser.add_argument("--namespace", help="delete only this namespace")
    parser.add_argument("--drop-index", action="store_true", help="delete the entire index")
    parser.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    args = parser.parse_args()

    load_dotenv()
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        sys.exit("Missing PINECONE_API_KEY in your .env file.")

    pc = Pinecone(api_key=api_key)

    if args.index not in pc.list_indexes().names():
        sys.exit(f"Index '{args.index}' does not exist. Nothing to clean.")

    index = pc.Index(args.index)
    stats = index.describe_index_stats()
    namespaces = {name: s.vector_count for name, s in stats.namespaces.items()}

    print(f"Index: {args.index}")
    print(f"Total vectors: {stats.total_vector_count}")
    for name, count in namespaces.items():
        print(f"  - namespace '{name or '(default)'}': {count} vectors")

    # ---- decide what to delete ------------------------------------------- #
    if args.drop_index:
        action = f"DELETE THE ENTIRE INDEX '{args.index}'"
    elif args.namespace is not None:
        action = f"delete all vectors in namespace '{args.namespace}'"
    else:
        action = "delete ALL vectors in ALL namespaces (the empty index stays)"

    if not args.yes:
        answer = input(f"\nThis will {action}. Type 'yes' to continue: ").strip().lower()
        if answer != "yes":
            sys.exit("Cancelled. Nothing was deleted.")

    # ---- do it ----------------------------------------------------------- #
    if args.drop_index:
        pc.delete_index(args.index)
        print(f"Index '{args.index}' deleted. Run json_rag.py to create a fresh one.")
        return

    targets = [args.namespace] if args.namespace is not None else list(namespaces.keys())
    if not targets:
        print("Index is already empty.")
        return

    for ns in targets:
        try:
            index.delete(delete_all=True, namespace=ns)
            print(f"  Cleared namespace '{ns or '(default)'}'")
        except Exception as exc:
            print(f"  [error] namespace '{ns or '(default)'}': {type(exc).__name__}: {exc}")

    print("\nDone. Index is now fresh.")


if __name__ == "__main__":
    main()