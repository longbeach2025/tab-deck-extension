#!/usr/bin/env python3

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EMBEDDING_VERSION = "emb-v1"
DEFAULT_MODEL = "BAAI/bge-m3"


def safe_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def sha1_text(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def build_embedding_input(link: dict[str, Any]) -> str:
    metadata = link.get("metadata", {})
    preprocess = metadata.get("preprocess", {})
    title = safe_text(preprocess.get("cleanTitle")) or safe_text(link.get("title"))
    summary = safe_text(preprocess.get("summary"))
    domain = safe_text(preprocess.get("domain"))
    content_type = safe_text(preprocess.get("contentType"))
    topics = preprocess.get("topics") if isinstance(preprocess.get("topics"), list) else []
    keywords = preprocess.get("keywords") if isinstance(preprocess.get("keywords"), list) else []
    topics_text = ", ".join([safe_text(item) for item in topics if safe_text(item)])
    keywords_text = ", ".join([safe_text(item) for item in keywords if safe_text(item)])
    url = safe_text(link.get("url"))
    parts = [title, summary, domain, content_type, topics_text, keywords_text, url]
    return " | ".join([part for part in parts if part])


def ensure_preprocess(link: dict[str, Any]) -> dict[str, Any]:
    metadata = link.setdefault("metadata", {})
    preprocess = metadata.setdefault("preprocess", {})
    if not isinstance(preprocess, dict):
        metadata["preprocess"] = {}
        preprocess = metadata["preprocess"]
    return preprocess


def should_process(preprocess: dict[str, Any], input_hash: str, force: bool) -> bool:
    if force:
        return True
    if preprocess.get("embeddingStatus") != "ready":
        return True
    if safe_text(preprocess.get("embeddingInputHash")) != input_hash:
        return True
    vector = preprocess.get("embedding")
    if not isinstance(vector, list) or len(vector) == 0:
        return True
    return False


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate local embeddings (bge-m3) from preprocessed Tab Deck JSON."
    )
    parser.add_argument("--input", required=True, help="Path to preprocessed JSON.")
    parser.add_argument("--output", required=True, help="Path to output JSON with embeddings.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="SentenceTransformer model id.")
    parser.add_argument("--batch-size", type=int, default=32, help="Embedding batch size.")
    parser.add_argument(
        "--checkpoint-size",
        type=int,
        default=200,
        help="Save output every N processed items.",
    )
    parser.add_argument("--device", default="cpu", help="cpu/cuda/mps or auto.")
    parser.add_argument("--force", action="store_true", help="Recompute embeddings for all rows.")
    parser.add_argument(
        "--normalize",
        action="store_true",
        help="Normalize vectors to unit length (recommended for cosine similarity).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    data = json.loads(input_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Invalid preprocessed JSON: top-level must be object.")
    rows = data.get("rows", {})
    links = rows.get("links", []) if isinstance(rows, dict) else []
    if not isinstance(links, list):
        raise ValueError("Invalid preprocessed JSON: rows.links must be array.")

    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "Missing dependency. Install with: pip3 install sentence-transformers"
        ) from exc

    model = SentenceTransformer(args.model, device=args.device)

    candidates: list[tuple[int, str, str]] = []
    for index, link in enumerate(links):
        preprocess = ensure_preprocess(link)
        input_text = build_embedding_input(link)
        input_hash = sha1_text(input_text)
        if should_process(preprocess, input_hash, args.force):
            candidates.append((index, input_text, input_hash))

    total = len(links)
    pending = len(candidates)
    print(
        f"[embedding-local] total={total} pending={pending} model={args.model} "
        f"batch_size={args.batch_size} device={args.device}"
    )

    ready = 0
    failed = 0
    since_last_checkpoint = 0

    for start in range(0, pending, args.batch_size):
        batch = candidates[start : start + args.batch_size]
        batch_texts = [item[1] for item in batch]
        try:
            vectors = model.encode(
                batch_texts,
                batch_size=args.batch_size,
                normalize_embeddings=bool(args.normalize),
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            processed_at = now_iso()
            for i, (index, _text, input_hash) in enumerate(batch):
                link = links[index]
                preprocess = ensure_preprocess(link)
                vector = vectors[i].tolist()
                preprocess["embeddingVersion"] = EMBEDDING_VERSION
                preprocess["embeddingProvider"] = "local"
                preprocess["embeddingModel"] = args.model
                preprocess["embeddingStatus"] = "ready"
                preprocess["embeddingInputHash"] = input_hash
                preprocess["embeddingDim"] = len(vector)
                preprocess["embeddingUpdatedAt"] = processed_at
                preprocess["embeddingError"] = ""
                preprocess["embedding"] = vector
                ready += 1
        except Exception as exc:
            error_text = str(exc)
            processed_at = now_iso()
            for index, _text, input_hash in batch:
                link = links[index]
                preprocess = ensure_preprocess(link)
                preprocess["embeddingVersion"] = EMBEDDING_VERSION
                preprocess["embeddingProvider"] = "local"
                preprocess["embeddingModel"] = args.model
                preprocess["embeddingStatus"] = "failed"
                preprocess["embeddingInputHash"] = input_hash
                preprocess["embeddingUpdatedAt"] = processed_at
                preprocess["embeddingError"] = error_text
                failed += 1

        since_last_checkpoint += len(batch)
        done = ready + failed
        percent = int((done / pending) * 100) if pending else 100
        print(f"[checkpoint] ready={ready} failed={failed} done={done}/{pending} ({percent}%)")
        if since_last_checkpoint >= args.checkpoint_size:
            data["generatedAt"] = now_iso()
            save_json(output_path, data)
            since_last_checkpoint = 0

    data["generatedAt"] = now_iso()
    save_json(output_path, data)
    print(f"[done] output={output_path} ready={ready} failed={failed}")


if __name__ == "__main__":
    main()
