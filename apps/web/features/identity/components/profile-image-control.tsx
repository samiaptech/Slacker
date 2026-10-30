"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import Image from "next/image";
import { Camera, LoaderCircle } from "lucide-react";
import { Button } from "@workspace/ui";
import { z } from "zod";

const isCloudinaryImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
};
const profileImageResponseSchema = z.object({ image: z.url().refine(isCloudinaryImageUrl) });
const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

type ProfileImageControlProps = Readonly<{
  apiBaseUrl: string;
  email: string;
  image: string | null;
  name: string;
  onImageChange: (image: string) => void;
}>;

const uploadErrorMessage = (status: number): string => {
  if (status === 401) return "Sign in again before changing your profile photo.";
  if (status === 413) return "Choose an image smaller than 5 MB.";
  if (status === 503) return "Image uploads are temporarily unavailable. Try again later.";
  if (status === 400) return "Choose a supported JPEG, PNG, or WebP image.";
  return "Your profile photo could not be updated. Please try again.";
};

export const ProfileImageControl = ({
  apiBaseUrl, email, image, name, onImageChange
}: ProfileImageControlProps): ReactElement => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const initials = (name || email).trim().slice(0, 1).toUpperCase();
  const imageSource = preview ?? (brokenImage === image ? null : image);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!PROFILE_IMAGE_TYPES.includes(file.type) || file.size > MAX_PROFILE_IMAGE_SIZE) {
      setMessage(file.size > MAX_PROFILE_IMAGE_SIZE
        ? "Choose an image smaller than 5 MB."
        : "Choose a JPEG, PNG, or WebP image.");
      return;
    }

    setPreview(URL.createObjectURL(file));
    setIsUploading(true);
    setMessage(null);
    let uploaded = false;
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(new URL("/profile/image", apiBaseUrl), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body
      });
      if (!response.ok) {
        setMessage(uploadErrorMessage(response.status));
        return;
      }
      const parsed = profileImageResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setMessage("The server returned an invalid profile photo.");
        return;
      }
      onImageChange(parsed.data.image);
      uploaded = true;
      setBrokenImage(null);
      setPreview(null);
      setMessage("Profile photo updated.");
    } catch {
      setMessage("Your profile photo could not be updated. Check your connection and try again.");
    } finally {
      setIsUploading(false);
      if (!uploaded) setPreview(null);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <div aria-label={`${name || email} profile photo`} className="relative flex size-24 items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/20 bg-[#b8e3d1] text-3xl font-semibold text-[#173b3a] shadow-xl shadow-black/10" role="img">
        {imageSource
          ? <Image alt="" className="size-full object-cover" height={96} onError={() => setBrokenImage(imageSource)} src={imageSource} unoptimized width={96} />
          : initials}
        {isUploading ? <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-[#173b3a]/25" /> : null}
      </div>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={isUploading}
        onChange={(event) => { void uploadImage(event); }}
        ref={fileInput}
        type="file"
      />
      <Button
        className="h-9 rounded-xl border-white/25 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white"
        disabled={isUploading}
        onClick={() => fileInput.current?.click()}
        type="button"
        variant="outline"
      >
        {isUploading
          ? <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />
          : <Camera aria-hidden="true" className="mr-2 size-4" />}
        {isUploading ? "Uploading…" : image ? "Change photo" : "Add photo"}
      </Button>
      {message ? (
        <p aria-live={message === "Profile photo updated." ? "polite" : "assertive"} className="max-w-48 text-center text-xs text-white/75" role={message === "Profile photo updated." ? "status" : "alert"}>{message}</p>
      ) : null}
      <p className="text-center text-[11px] text-white/55">JPEG, PNG, or WebP · up to 5 MB</p>
    </div>
  );
};
