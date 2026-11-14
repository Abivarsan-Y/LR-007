#!/usr/bin/env python3
"""
High-Speed Parallel Multi-Threaded Downloader for NASA PGDA Datasets.
Uses HTTP Range headers to bypass single-thread server throttling.
"""

import os
import sys
import time
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"
OUT_PATH = Path("data/raw/LDEM_80S_80MPP_ADJ.TIF")
NUM_CHUNKS = 16


def download_chunk(url: str, start: int, end: int, chunk_idx: int, temp_dir: Path):
    chunk_file = temp_dir / f"chunk_{chunk_idx:02d}.part"
    headers = {"Range": f"bytes={start}-{end}"}

    for attempt in range(3):
        try:
            r = requests.get(url, headers=headers, stream=True, timeout=20)
            r.raise_for_status()
            with open(chunk_file, "wb") as f:
                for b in r.iter_content(chunk_size=64 * 1024):
                    if b:
                        f.write(b)
            return chunk_idx, chunk_file.stat().st_size
        except Exception as e:
            if attempt == 2:
                raise e
            time.sleep(1)


def main():
    print(f"Connecting to NASA PGDA: {URL}...")
    head_resp = requests.head(URL, timeout=10)
    head_resp.raise_for_status()

    total_bytes = int(head_resp.headers.get("content-length", 0))
    if not total_bytes:
        print("Error: Could not determine Content-Length.")
        sys.exit(1)

    print(f"Total Size: {total_bytes / (1024*1024):.1f} MB. Spawning {NUM_CHUNKS} parallel download streams...")

    temp_dir = Path("data/raw/_chunks")
    temp_dir.mkdir(parents=True, exist_ok=True)

    chunk_size = total_bytes // NUM_CHUNKS
    ranges = []
    for i in range(NUM_CHUNKS):
        start = i * chunk_size
        end = (start + chunk_size - 1) if i < NUM_CHUNKS - 1 else total_bytes - 1
        ranges.append((start, end, i))

    start_time = time.time()
    completed_bytes = 0

    with ThreadPoolExecutor(max_workers=NUM_CHUNKS) as executor:
        future_to_chunk = {
            executor.submit(download_chunk, URL, start, end, idx, temp_dir): idx
            for (start, end, idx) in ranges
        }

        for future in as_completed(future_to_chunk):
            idx, size = future.result()
            completed_bytes += size
            pct = (completed_bytes / total_bytes) * 100.0
            elapsed = time.time() - start_time
            rate = (completed_bytes / (1024 * 1024)) / max(elapsed, 0.1)
            sys.stdout.write(f"\rProgress: {completed_bytes / (1024*1024):.1f} / {total_bytes / (1024*1024):.1f} MB ({pct:.1f}%) | Speed: {rate:.2f} MB/s")
            sys.stdout.flush()

    print(f"\nAll {NUM_CHUNKS} chunks downloaded. Assembling into {OUT_PATH}...")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "wb") as outfile:
        for i in range(NUM_CHUNKS):
            chunk_file = temp_dir / f"chunk_{i:02d}.part"
            with open(chunk_file, "rb") as cf:
                outfile.write(cf.read())
            chunk_file.unlink()

    temp_dir.rmdir()
    elapsed = time.time() - start_time
    print(f"SUCCESS: Real NASA LOLA DEM assembled in {elapsed:.1f} seconds! Final size: {OUT_PATH.stat().st_size / (1024*1024):.1f} MB")


if __name__ == "__main__":
    main()
