export const MAX_AVATAR_ZOOM = 4;

export interface AvatarImageSize {
  width: number;
  height: number;
}

/** The crop center is measured in original image pixels, independent of viewport size. */
export interface AvatarCrop {
  zoom: number;
  centerX: number;
  centerY: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function constrainAvatarCrop(
  image: AvatarImageSize,
  crop: AvatarCrop,
): AvatarCrop {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error("Kích thước ảnh không hợp lệ.");
  }
  const zoom = clamp(crop.zoom, 1, MAX_AVATAR_ZOOM);
  const halfSize = Math.min(image.width, image.height) / zoom / 2;
  return {
    zoom,
    centerX: clamp(crop.centerX, halfSize, image.width - halfSize),
    centerY: clamp(crop.centerY, halfSize, image.height - halfSize),
  };
}

export function getAvatarCropRect(image: AvatarImageSize, crop: AvatarCrop) {
  const constrained = constrainAvatarCrop(image, crop);
  const size = Math.min(image.width, image.height) / constrained.zoom;
  return {
    x: constrained.centerX - size / 2,
    y: constrained.centerY - size / 2,
    size,
  };
}
