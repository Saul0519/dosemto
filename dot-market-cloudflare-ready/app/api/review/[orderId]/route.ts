import { currentUser } from "../../../../db/discord-session";
import { validateImageFile } from "../../../../db/image-validation";
import { deleteReview, deleteStoredImage, getOrderForReview, saveReview } from "../../../../db/reviews";

export const dynamic = "force-dynamic";

/** One photo, big enough for a phone snap of a finished wall. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const author = await currentUser(request).catch(() => null);
  if (!author) {
    return Response.json({ error: "디스코드로 로그인한 뒤 후기를 남길 수 있습니다." }, { status: 401 });
  }

  // The form sends multipart now that a photo can come with it.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "요청을 읽지 못했습니다." }, { status: 400 });
  }

  const rating = Number(form.get("rating"));
  if (!Number.isFinite(rating)) {
    return Response.json({ error: "별점을 골라주세요." }, { status: 400 });
  }

  const photo = form.get("photo");
  let imageKey: string | undefined;

  if (photo instanceof File && photo.size > 0) {
    // Checked before anything is written, and ownership is checked before the
    // upload, so a stranger cannot fill the bucket with files against someone
    // else's order number.
    const order = await getOrderForReview(orderId).catch(() => null);
    if (!order || order.ownerId !== author.id) {
      return Response.json({ error: "본인이 주문한 건에만 후기를 남길 수 있습니다." }, { status: 403 });
    }

    let checked: Awaited<ReturnType<typeof validateImageFile>>;
    try {
      checked = await validateImageFile(photo, { maxBytes: MAX_PHOTO_BYTES });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "사진을 확인하지 못했습니다." },
        { status: 400 },
      );
    }

    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) {
      return Response.json({ error: "사진 저장소가 연결되지 않았습니다." }, { status: 503 });
    }
    // The key carries a random part so a replacement never lands on the URL a
    // cache is already holding for the old photo.
    imageKey = `reviews/${orderId}/${crypto.randomUUID()}.${checked.extension}`;
    try {
      await env.BUCKET.put(imageKey, await photo.arrayBuffer(), {
        httpMetadata: { contentType: checked.mime },
      });
    } catch {
      return Response.json({ error: "사진을 저장하지 못했습니다." }, { status: 503 });
    }
  }

  try {
    // saveReview owns the ownership and status checks so every caller shares them.
    const result = await saveReview({
      orderId,
      authorId: author.id,
      authorName: author.name,
      rating,
      body: String(form.get("body") ?? ""),
      imageKey,
      removeImage: form.get("removePhoto") === "1",
    });
    if (!result.ok) {
      // The review did not save, so the file it would have belonged to is litter.
      if (imageKey) await deleteStoredImage(imageKey);
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch {
    if (imageKey) await deleteStoredImage(imageKey);
    return Response.json({ error: "후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const author = await currentUser(request).catch(() => null);
  if (!author) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    // Scoped to the author, so a shop cannot delete a review it dislikes.
    const result = await deleteReview(orderId, author.id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "후기를 지우지 못했습니다." }, { status: 503 });
  }
}
