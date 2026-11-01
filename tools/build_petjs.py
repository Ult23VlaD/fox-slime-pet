#!/usr/bin/env python3
"""Assemble a Three.js desktop-pet bundle: three.min.js + GLTFLoader + runtime with embedded GLB.

Usage:
  python build_petjs.py --glb model.glb --three three.min.js --loader GLTFLoader.js \
      --runtime runtime.js --out pets/<pet-id>/pet.js

The runtime file must contain the placeholder __GLB_BASE64__ where the base64 GLB goes.
"""
import argparse
import base64
import pathlib

ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--three", required=True)
ap.add_argument("--loader", required=True)
ap.add_argument("--runtime", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

glb_b64 = base64.b64encode(pathlib.Path(args.glb).read_bytes()).decode("ascii")
three = pathlib.Path(args.three).read_text(encoding="utf-8")
loader = pathlib.Path(args.loader).read_text(encoding="utf-8")
runtime = pathlib.Path(args.runtime).read_text(encoding="utf-8")
assert "__GLB_BASE64__" in runtime, "runtime must contain __GLB_BASE64__ placeholder"
runtime = runtime.replace("__GLB_BASE64__", glb_b64)

out = three + "\n;\n" + loader + "\n;\n" + runtime
p = pathlib.Path(args.out)
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(out, encoding="utf-8")
print("pet.js bytes:", p.stat().st_size)
