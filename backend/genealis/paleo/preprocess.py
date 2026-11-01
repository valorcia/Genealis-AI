"""Préparation d'une COPIE de travail de l'image (l'original n'est jamais modifié).

Toutes les fonctions reçoivent des octets et renvoient de nouveaux octets. Les coordonnées sont exprimées en
millièmes (0-1000) de l'image ORIGINALE telle qu'elle s'affiche (orientation EXIF appliquée, comme dans le
navigateur). `Transform` permet de reconvertir une zone lue sur la copie (recadrée et/ou pivotée) vers l'original.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Optional

from PIL import Image, ImageFilter, ImageOps

Image.MAX_IMAGE_PIXELS = 200_000_000  # scans d'archives très grands, mais pas illimités

IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/tiff", "image/bmp", "image/gif"}
DEFAULT_MAX_SIDE = 3000


@dataclass
class Transform:
    """Passage de l'original à la copie : recadrage (0-1000 de l'original) puis rotation horaire (0/90/180/270)."""

    crop: Optional[tuple[float, float, float, float]] = None  # x, y, w, h en 0-1000 de l'original
    rotate: int = 0

    def to_dict(self) -> dict:
        return {"crop": list(self.crop) if self.crop else None, "rotate": self.rotate}

    def point_to_original(self, u: float, v: float) -> tuple[float, float]:
        """(u, v) en 0-1 de la copie → (x, y) en 0-1 de l'original."""
        r = self.rotate % 360
        if r == 90:
            u, v = v, 1 - u
        elif r == 180:
            u, v = 1 - u, 1 - v
        elif r == 270:
            u, v = 1 - v, u
        if self.crop:
            cx, cy, cw, ch = (c / 1000 for c in self.crop)
            u, v = cx + u * cw, cy + v * ch
        return u, v

    def bbox_to_original(self, bbox: list[float] | None) -> list[int] | None:
        """[x, y, w, h] (0-1000 de la copie) → [x, y, w, h] (0-1000 de l'original)."""
        if not bbox or len(bbox) != 4:
            return None
        x, y, w, h = (float(b) / 1000 for b in bbox)
        p1 = self.point_to_original(x, y)
        p2 = self.point_to_original(x + w, y + h)
        x0, x1 = sorted((p1[0], p2[0]))
        y0, y1 = sorted((p1[1], p2[1]))
        return clamp_bbox([x0 * 1000, y0 * 1000, (x1 - x0) * 1000, (y1 - y0) * 1000])


def clamp_bbox(b: list[float]) -> list[int]:
    x, y, w, h = b
    x = max(0.0, min(1000.0, x))
    y = max(0.0, min(1000.0, y))
    w = max(0.0, min(1000.0 - x, w))
    h = max(0.0, min(1000.0 - y, h))
    return [round(x), round(y), round(w), round(h)]


def box2d_to_bbox(box: list | None) -> list[float] | None:
    """Format Gemini [ymin, xmin, ymax, xmax] (0-1000) → [x, y, w, h]."""
    try:
        ymin, xmin, ymax, xmax = (float(v) for v in box)  # type: ignore[union-attr]
    except (TypeError, ValueError):
        return None
    if xmax < xmin:
        xmin, xmax = xmax, xmin
    if ymax < ymin:
        ymin, ymax = ymax, ymin
    if xmax - xmin <= 0 or ymax - ymin <= 0:
        return None
    return [xmin, ymin, xmax - xmin, ymax - ymin]


def is_image(mime: str | None, data: bytes | None = None) -> bool:
    if mime in IMAGE_MIMES:
        return True
    if data is not None:
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.verify()
            return True
        except Exception:
            return False
    return False


def open_oriented(data: bytes) -> Image.Image:
    """Ouvre l'image et applique l'orientation EXIF (comme l'affichage du navigateur)."""
    im = Image.open(io.BytesIO(data))
    try:
        im.seek(0)  # TIFF multipage : première page
    except EOFError:
        pass
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    return im


def encode(im: Image.Image, fmt: str = "JPEG", quality: int = 90) -> tuple[bytes, str]:
    buf = io.BytesIO()
    if fmt.upper() == "PNG":
        im.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png"
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.save(buf, format="JPEG", quality=quality)
    return buf.getvalue(), "image/jpeg"


def parse_crop(value: str | list | tuple | None) -> Optional[tuple[float, float, float, float]]:
    """« x,y,w,h » (0-1000) → tuple validé, ou None."""
    if value is None or value == "":
        return None
    parts = value.split(",") if isinstance(value, str) else list(value)
    if len(parts) != 4:
        raise ValueError("Découpe attendue : x,y,w,h (en millièmes de l'image)")
    x, y, w, h = (float(p) for p in parts)
    if w <= 0 or h <= 0:
        raise ValueError("Découpe vide")
    b = clamp_bbox([x, y, w, h])
    if b[2] <= 0 or b[3] <= 0:
        raise ValueError("Découpe hors de l'image")
    return tuple(float(v) for v in b)  # type: ignore[return-value]


@dataclass
class WorkingCopy:
    data: bytes
    mime: str
    width: int
    height: int
    transform: Transform
    operations: list[str] = field(default_factory=list)
    original_size: tuple[int, int] = (0, 0)

    def describe(self) -> dict:
        return {"operations": self.operations, "transform": self.transform.to_dict(), "sent_size": [self.width, self.height],
                "original_size": list(self.original_size), "mime": self.mime}


def apply_ops(im: Image.Image, *, rotate: int = 0, crop: Optional[tuple[float, float, float, float]] = None,
              contrast: bool = False, gray: bool = False, negative: bool = False, sharpen: bool = False,
              max_side: int | None = DEFAULT_MAX_SIDE, min_side: int | None = None, max_upscale: float = 4.0) -> tuple[Image.Image, list[str]]:
    """Applique les opérations à une copie PIL (recadrage → rotation → couleurs → taille)."""
    ops: list[str] = []
    out = im.copy()
    if crop:
        x, y, w, h = crop
        W, H = out.size
        box = (int(x / 1000 * W), int(y / 1000 * H), max(int((x + w) / 1000 * W), int(x / 1000 * W) + 1),
               max(int((y + h) / 1000 * H), int(y / 1000 * H) + 1))
        out = out.crop(box)
        ops.append(f"découpe {','.join(str(int(c)) for c in crop)}")
    r = int(rotate or 0) % 360
    if r in (90, 180, 270):
        out = out.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}[r])
        ops.append(f"rotation {r}°")
    if gray:
        out = ImageOps.grayscale(out)
        ops.append("niveaux de gris")
    if contrast:
        out = ImageOps.autocontrast(out if out.mode in ("RGB", "L") else out.convert("RGB"), cutoff=1)
        ops.append("contraste automatique")
    if negative:
        out = ImageOps.invert(out if out.mode in ("RGB", "L") else out.convert("RGB"))
        ops.append("négatif")
    if sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=3))
        ops.append("netteté")
    if min_side and max(out.size) < min_side:
        f = min(max_upscale, min_side / max(out.size))
        if f > 1.01:
            out = out.resize((max(1, int(out.width * f)), max(1, int(out.height * f))), Image.Resampling.LANCZOS)
            ops.append(f"agrandissement ×{f:.1f}")
    if max_side and max(out.size) > max_side:
        f = max_side / max(out.size)
        out = out.resize((max(1, int(out.width * f)), max(1, int(out.height * f))), Image.Resampling.LANCZOS)
        ops.append(f"réduction à {max_side} px")
    return out, ops


def working_copy(data: bytes, *, rotate: int = 0, crop=None, contrast: bool = True, gray: bool = False,
                 negative: bool = False, sharpen: bool = False, max_side: int | None = DEFAULT_MAX_SIDE,
                 min_side: int | None = None, fmt: str = "JPEG") -> WorkingCopy:
    """Copie de travail prête à envoyer au modèle, avec la transformation inverse vers l'original."""
    im = open_oriented(data)
    crop_t = parse_crop(crop) if not isinstance(crop, tuple) else crop
    out, ops = apply_ops(im, rotate=rotate, crop=crop_t, contrast=contrast, gray=gray, negative=negative, sharpen=sharpen,
                         max_side=max_side, min_side=min_side)
    b, mime = encode(out, fmt)
    return WorkingCopy(b, mime, out.width, out.height, Transform(crop_t, int(rotate or 0) % 360), ops, im.size)


def crop_region(im: Image.Image, bbox: list[float], *, margin_x: float = 0.25, margin_y: float = 1.0,
                min_side: int = 1600, contrast: bool = True) -> tuple[bytes, str, Transform, tuple[int, int]]:
    """Découpe agrandie d'une zone (bbox 0-1000 de l'original) avec une marge de contexte, pour la seconde passe."""
    x, y, w, h = (float(v) for v in bbox)
    mx, my = max(w * margin_x, 15.0), max(h * margin_y, 15.0)
    region = clamp_bbox([x - mx, y - my, w + 2 * mx, h + 2 * my])
    crop_t = tuple(float(v) for v in region)
    out, _ = apply_ops(im, crop=crop_t, contrast=contrast, sharpen=True, max_side=3000, min_side=min_side)  # type: ignore[arg-type]
    data, mime = encode(out, "PNG")
    return data, mime, Transform(crop_t, 0), out.size  # type: ignore[arg-type]


def render_view(data: bytes, *, rotate: int = 0, contrast: float | None = None, auto_contrast: bool = False,
                negative: bool = False, gray: bool = False, crop=None, max_side: int | None = 2400) -> tuple[bytes, str]:
    """Image dérivée pour l'affichage (calculée à la volée, jamais enregistrée à la place de l'original).

    `contrast` : facteur (1 = inchangé, 2 = deux fois plus contrasté) ; `auto_contrast` : étirement automatique."""
    im = open_oriented(data)
    crop_t = parse_crop(crop)
    out, _ = apply_ops(im, rotate=rotate, crop=crop_t, gray=gray, contrast=auto_contrast, max_side=max_side)
    if contrast is not None and abs(float(contrast) - 1.0) > 0.01:
        from PIL import ImageEnhance

        out = ImageEnhance.Contrast(out if out.mode in ("RGB", "L") else out.convert("RGB")).enhance(max(0.2, min(4.0, float(contrast))))
    if negative:
        out = ImageOps.invert(out if out.mode in ("RGB", "L") else out.convert("RGB"))
    return encode(out, "JPEG", 88)


def pdf_page_png(data: bytes, page: int = 0, dpi: int = 200) -> Optional[bytes]:
    """Rend une page de PDF en PNG (PyMuPDF optionnel) ; None si indisponible."""
    try:
        import fitz  # type: ignore
    except ImportError:
        return None
    with fitz.open(stream=data, filetype="pdf") as doc:
        if page >= len(doc):
            page = 0
        return doc[page].get_pixmap(dpi=dpi).tobytes("png")
