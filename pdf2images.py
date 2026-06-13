#!/usr/bin/env python3
"""
Convert PDF pages to images optimized for LLM consumption.

Resolution strategy:
- 150 DPI: Good for most text-heavy PDFs, minimal token usage
- 200 DPI: Balanced - readable with reasonable token cost
- 300 DPI: High quality for complex layouts, charts, or small text

For LLMs, 150-200 DPI is usually sufficient. Higher DPI wastes tokens
without improving comprehension for most documents.

Usage:
    python pdf2images.py input.pdf [output_dir] [--dpi 200] [--format png]
"""

import argparse
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
    from PIL import Image
except ImportError:
    print("Error: Required packages not installed. Run: pip install PyMuPDF Pillow")
    sys.exit(1)


def pdf_to_images(
    pdf_path: str,
    output_dir: str = None,
    dpi: int = 150,
    fmt: str = "jpg",
    max_width: int = 1200,
) -> list[Path]:
    """
    Convert PDF pages to images.

    Args:
        pdf_path: Path to input PDF
        output_dir: Directory for output images (default: same as PDF)
        dpi: Resolution in dots per inch (100-200 recommended for LLMs)
        fmt: Output format - 'png' (lossless) or 'jpg' (smaller files)
        max_width: Maximum width in pixels (resizes if larger)

    Returns:
        List of paths to generated images
    """
    pdf = fitz.open(pdf_path)
    pdf_stem = Path(pdf_path).stem

    if output_dir:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path(pdf_path).parent

    # DPI to zoom factor: 72 is PDF base resolution
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)

    image_paths = []
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        pix = page.get_pixmap(matrix=matrix)

        # Resize if wider than max_width
        suffix = "jpg" if fmt.lower() in ("jpg", "jpeg") else "png"
        filename = f"{pdf_stem}_page_{page_num + 1:03d}.{suffix}"
        out_path = out_dir / filename

        if pix.width > max_width:
            # Save to temp buffer then resize with PIL
            import io
            img_data = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_data))
            scale = max_width / pix.width
            new_width = max_width
            new_height = int(pix.height * scale)
            img = img.resize((new_width, new_height), Image.LANCZOS)
            if suffix == "jpg":
                img.save(str(out_path), quality=75)
            else:
                img.save(str(out_path))
        else:
            if suffix == "jpg":
                pix.save(str(out_path), jpg_quality=75)
            else:
                pix.save(str(out_path))

        image_paths.append(out_path)
        print(f"  Page {page_num + 1}/{len(pdf)}: {out_path}")

    pdf.close()
    return image_paths


def main():
    parser = argparse.ArgumentParser(
        description="Convert PDF pages to images for LLM analysis"
    )
    parser.add_argument("pdf", help="Path to input PDF file")
    parser.add_argument("output_dir", nargs="?", help="Output directory (default: same as PDF)")
    parser.add_argument(
        "--dpi",
        type=int,
        default=150,
        choices=[72, 100, 150, 200],
        help="Resolution in DPI (default: 150, recommended: 100-150 for LLMs)",
    )
    parser.add_argument(
        "--format",
        "-f",
        default="jpg",
        choices=["png", "jpg", "jpeg"],
        help="Output format (default: jpg)",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=1200,
        help="Max image width in pixels (default: 1200)",
    )

    args = parser.parse_args()

    if not Path(args.pdf).exists():
        print(f"Error: File not found: {args.pdf}")
        sys.exit(1)

    print(f"Converting {args.pdf} to images at {args.dpi} DPI...")
    paths = pdf_to_images(args.pdf, args.output_dir, args.dpi, args.format, args.max_width)
    print(f"\nDone! Generated {len(paths)} image(s)")


if __name__ == "__main__":
    main()
