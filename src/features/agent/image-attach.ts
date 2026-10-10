import { base64Bytes, formatBytes, IMAGE_TYPES, MAX_IMAGE_BYTES, type ChatImage } from "@/lib/acp/images"

// Longest side of an attached image after downscaling.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.9

export const IMAGE_ACCEPT = IMAGE_TYPES.join(",")

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't encode the image"))), type, quality))
}

async function blobBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"))
    reader.readAsDataURL(blob)
  })
  return url.slice(url.indexOf(",") + 1)
}

// A pasted/dropped/picked image, ready to send: downscaled to MAX_DIMENSION
// and re-encoded through a canvas (which also drops EXIF and other
// metadata). JPEGs stay JPEG; everything else becomes PNG, or JPEG when the
// PNG would be too big.
export async function prepareImage(file: Blob): Promise<ChatImage> {
  if (!file.type.startsWith("image/")) throw new Error("Not an image")
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("Couldn't read the image")
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png"
  let image: ChatImage = { mimeType: type, data: await blobBase64(await toBlob(canvas, type, JPEG_QUALITY)) }
  if (base64Bytes(image.data) > MAX_IMAGE_BYTES && type === "image/png") {
    // JPEG has no alpha: put white behind transparent pixels, not black.
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.globalCompositeOperation = "destination-over"
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    image = { mimeType: "image/jpeg", data: await blobBase64(await toBlob(canvas, "image/jpeg", JPEG_QUALITY)) }
  }
  const bytes = base64Bytes(image.data)
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image is ${formatBytes(bytes)} (max ${formatBytes(MAX_IMAGE_BYTES)})`)
  return image
}

export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === "file" ? entry.getAsFile() : null
    if (file?.type.startsWith("image/")) files.push(file)
  }
  return files
}
