<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Synthetic static export fixtures (C3.22)

These ZIPs were generated locally with Python's standard `zipfile` writer.
All names, pages and image bytes are fictional. `site.zip` contains two HTML
pages, a generated two-pixel PNG and inert CSS/JavaScript; none are executed.
Other fixtures isolate traversal, absolute/backslash paths, case ambiguity,
symlinks, foreign bases, percent-escaped literal names, damaged CRC, encryption,
unsupported compression, excessive declared expansion and truncation. CRC and
ZIP bytes come from an independent standard-library writer, not the reader.

`ignored-reader.zip` stores a synthetic reader address in an unimported text
entry. It proves that private-original erasure cannot infer absence of personal
data from the public HTML preview or the archive's imported content.

`root-target.zip` covers versioned outer-fragment preservation and exact legacy
manifest recovery. `unsupported-svg.zip` keeps the ordinary SVG upload refusal
while proving supported raster content can finish with a visible omission report.
