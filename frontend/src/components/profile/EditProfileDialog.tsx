"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import {
  ApiError,
  updateMyProfile,
  uploadImage,
  type UpdateProfileRequest,
} from "@/lib/api";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validations";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE_MB,
  QUERY_KEYS,
  ROUTES,
} from "@/constants";
import { getAvatarUrl } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types";
import { AvatarCropDialog } from "./AvatarCropDialog";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60";
const secondaryClass =
  "rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60";
const primaryClass =
  "rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60";

function valuesFromProfile(profile: Profile): UpdateProfileInput {
  return {
    display_name: profile.display_name,
    username: profile.username,
    bio: profile.bio ?? "",
    home_city: profile.home_city ?? "",
  };
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (error.status === 403) return "Bạn không có quyền chỉnh sửa hồ sơ này.";
    if (error.status === 413)
      return `Ảnh vượt quá ${MAX_IMAGE_SIZE_MB} MB. Vui lòng chọn ảnh nhỏ hơn.`;
    if (error.status === 429)
      return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
    if (error.status >= 500)
      return "Máy chủ chưa thể lưu hồ sơ. Vui lòng thử lại.";
    return error.message;
  }
  return "Không thể kết nối để lưu hồ sơ. Vui lòng kiểm tra mạng và thử lại.";
}

const textFields = [
  {
    name: "display_name",
    label: "Tên hiển thị",
    maxLength: 80,
    autoComplete: "name",
    placeholder: "Tên hiển thị của bạn",
  },
  {
    name: "username",
    label: "Tên người dùng",
    maxLength: 30,
    autoComplete: "username",
    placeholder: "ten_nguoi_dung",
  },
  {
    name: "home_city",
    label: "Thành phố (tùy chọn)",
    maxLength: 120,
    autoComplete: "address-level2",
    placeholder: "Bạn đang sống ở đâu?",
  },
] as const;

export function EditProfileDialog({
  profile,
  canEdit,
}: {
  profile: Profile;
  canEdit: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const uploadedAvatar = useRef<{ file: File; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const savingRef = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setFocus,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: valuesFromProfile(profile),
    mode: "onBlur",
  });

  useEffect(() => {
    if (!open || !file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, open]);

  useEffect(() => {
    if (open && !canEdit) {
      setError("root", {
        message:
          "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi lưu.",
      });
    }
  }, [open, canEdit, setError]);

  const closeEditor = () => {
    setOpen(false);
    setDiscardOpen(false);
    setFile(null);
    setCropSource(null);
    uploadedAvatar.current = null;
  };

  const mutation = useMutation({
    mutationFn: async (values: UpdateProfileInput) => {
      if (useAuthStore.getState().user?.id !== profile.id) {
        throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn.");
      }
      const input: UpdateProfileRequest = { ...values };
      if (file) {
        // Reuse a successful upload if PATCH fails, so retrying does not upload twice.
        if (uploadedAvatar.current?.file !== file) {
          const image = await uploadImage(file);
          uploadedAvatar.current = { file, url: image.url };
        }
        input.avatar_url = uploadedAvatar.current.url;
      } else if (avatarRemoved) {
        input.avatar_url = null;
      }
      if (useAuthStore.getState().user?.id !== profile.id) {
        throw new ApiError(401, "UNAUTHORIZED", "Phiên đăng nhập đã hết hạn.");
      }
      return updateMyProfile(input);
    },
    onSuccess: (updated) => {
      // A session may have ended while the request was in flight. Never restore it here.
      if (useAuthStore.getState().user?.id !== updated.id) {
        closeEditor();
        return;
      }
      useAuthStore.getState().updateProfile(updated);
      queryClient.setQueryData(QUERY_KEYS.profiles.me, updated);
      if (updated.username !== profile.username) {
        queryClient.removeQueries({
          queryKey: QUERY_KEYS.profiles.byUsername(profile.username),
        });
      }
      queryClient.setQueryData(
        QUERY_KEYS.profiles.byUsername(updated.username),
        updated,
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.posts.all });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.comments.all });
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notifications.all,
      });
      closeEditor();
      toast.success("Đã cập nhật hồ sơ");
      if (updated.username !== profile.username) {
        router.replace(ROUTES.profile(updated.username), { scroll: false });
      } else {
        router.refresh();
      }
    },
  });

  const pending = isSubmitting || mutation.isPending;

  useEffect(() => {
    if (!open || pending || cropSource) return;
    if (errors.username?.type === "server") setFocus("username");
    else if (errors.root) errorRef.current?.focus();
  }, [open, pending, cropSource, errors.username, errors.root, setFocus]);

  const avatarChanged =
    file !== null || (avatarRemoved && !!profile.avatar_url);
  const requestClose = () => {
    if (savingRef.current || cropSource) return;
    if (isDirty || avatarChanged) setDiscardOpen(true);
    else closeEditor();
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestClose();
      return;
    }
    reset(valuesFromProfile(profile));
    setFile(null);
    setCropSource(null);
    setAvatarRemoved(false);
    setAvatarError("");
    uploadedAvatar.current = null;
    setOpen(true);
  };

  const selectFile = (selected?: File) => {
    if (!selected) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) {
      setAvatarError("Chỉ hỗ trợ ảnh JPEG, PNG và WebP.");
      return;
    }
    if (
      selected.size === 0 ||
      selected.size > MAX_IMAGE_SIZE_MB * 1024 * 1024
    ) {
      setAvatarError(
        `Chọn ảnh có dung lượng lớn hơn 0 và không quá ${MAX_IMAGE_SIZE_MB} MB.`,
      );
      return;
    }
    setAvatarError("");
    setCropSource(selected);
  };

  const submit = handleSubmit(async (values) => {
    if (savingRef.current || cropSource) return;
    savingRef.current = true;
    clearErrors("root");
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.code === "USERNAME_TAKEN") {
        setError(
          "username",
          {
            type: "server",
            message: "Tên người dùng đã được sử dụng. Vui lòng chọn tên khác.",
          },
          { shouldFocus: true },
        );
      } else {
        setError("root", { message: describeError(error) });
      }
    } finally {
      savingRef.current = false;
    }
  });

  const avatarSrc =
    (file ? previewUrl : null) ??
    getAvatarUrl(avatarRemoved ? null : profile.avatar_url, profile.username);

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      {canEdit && (
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-800 shadow-sm transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-800"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Chỉnh sửa hồ sơ
          </button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <Dialog.Content
          className="fixed inset-0 z-[101] flex flex-col bg-surface shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div>
              <Dialog.Title className="text-xl font-bold text-ink">
                Chỉnh sửa hồ sơ
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-ink-muted">
                Chia sẻ một chút về bạn và hành trình của mình.
              </Dialog.Description>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={requestClose}
              disabled={pending}
              aria-label="Đóng chỉnh sửa hồ sơ"
              className="rounded-full p-2 text-ink-muted hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <form
            onSubmit={submit}
            noValidate
            aria-busy={pending}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarSrc}
                    alt="Xem trước ảnh đại diện"
                    onError={() => {
                      if (file && previewUrl) {
                        setFile(null);
                        uploadedAvatar.current = null;
                        setAvatarError(
                          "Không đọc được ảnh. Vui lòng chọn ảnh khác.",
                        );
                      }
                    }}
                    className="h-20 w-20 shrink-0 rounded-full bg-surface-muted object-cover ring-2 ring-border"
                  />
                  <div className="space-y-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES.join(",")}
                      aria-label="Chọn ảnh đại diện"
                      disabled={pending}
                      className="hidden"
                      onChange={(event) => {
                        selectFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <button
                      ref={avatarButtonRef}
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={pending}
                      aria-describedby={
                        avatarError ? "profile-avatar-error" : undefined
                      }
                      className={`${secondaryClass} inline-flex items-center gap-2`}
                    >
                      <Camera className="h-4 w-4" aria-hidden="true" />
                      Đổi ảnh đại diện
                    </button>
                    <div className="flex flex-wrap gap-3">
                      {file && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setFile(null);
                            setAvatarRemoved(false);
                            setAvatarError("");
                            uploadedAvatar.current = null;
                          }}
                          className="rounded text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Hủy ảnh đã chọn
                        </button>
                      )}
                      {(file || (!avatarRemoved && profile.avatar_url)) && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setFile(null);
                            setAvatarRemoved(true);
                            setAvatarError("");
                            uploadedAvatar.current = null;
                          }}
                          className="rounded text-xs text-red-500 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          Xóa ảnh đại diện
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-ink-muted">
                  JPEG, PNG hoặc WebP, tối đa {MAX_IMAGE_SIZE_MB} MB. Ảnh mới
                  được căn chỉnh trước khi áp dụng và chỉ tải lên khi bạn lưu.
                </p>
                {avatarError && (
                  <p
                    id="profile-avatar-error"
                    role="alert"
                    className="mt-1 text-sm text-red-500"
                  >
                    {avatarError}
                  </p>
                )}
              </div>

              {textFields.map((field) => (
                <div key={field.name}>
                  <label
                    htmlFor={`profile-${field.name}`}
                    className="mb-1.5 block text-sm font-medium text-ink"
                  >
                    {field.label}
                  </label>
                  <input
                    {...register(field.name)}
                    id={`profile-${field.name}`}
                    type="text"
                    autoComplete={field.autoComplete}
                    autoCapitalize={
                      field.name === "username" ? "none" : undefined
                    }
                    spellCheck={field.name === "username" ? false : undefined}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    required={
                      field.name === "display_name" || field.name === "username"
                    }
                    disabled={pending}
                    aria-invalid={!!errors[field.name]}
                    aria-describedby={
                      errors[field.name]
                        ? `profile-${field.name}-error`
                        : field.name === "username"
                          ? "profile-username-hint"
                          : undefined
                    }
                    className={inputClass}
                  />
                  {field.name === "username" && (
                    <p
                      id="profile-username-hint"
                      className="mt-1 text-xs text-ink-muted"
                    >
                      3–30 ký tự: chữ cái không dấu, số hoặc dấu _. Đổi tên sẽ
                      đổi liên kết hồ sơ.
                    </p>
                  )}
                  {errors[field.name] && (
                    <p
                      id={`profile-${field.name}-error`}
                      role="alert"
                      className="mt-1 text-sm text-red-500"
                    >
                      {errors[field.name]?.message}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label
                  htmlFor="profile-bio"
                  className="mb-1.5 block text-sm font-medium text-ink"
                >
                  Giới thiệu (tùy chọn)
                </label>
                <textarea
                  {...register("bio")}
                  id="profile-bio"
                  rows={3}
                  maxLength={500}
                  disabled={pending}
                  placeholder="Những nơi bạn yêu thích, những chuyến đi bạn mong chờ…"
                  aria-invalid={!!errors.bio}
                  aria-describedby={
                    errors.bio ? "profile-bio-error" : "profile-bio-count"
                  }
                  className={`${inputClass} resize-y`}
                />
                <p
                  id="profile-bio-count"
                  className="mt-1 text-right text-xs text-ink-muted"
                >
                  {watch("bio").length}/500
                </p>
                {errors.bio && (
                  <p
                    id="profile-bio-error"
                    role="alert"
                    className="mt-1 text-sm text-red-500"
                  >
                    {errors.bio.message}
                  </p>
                )}
              </div>
              {errors.root && (
                <p
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className="rounded-xl bg-red-500/10 p-3 text-sm text-red-500 outline-none"
                >
                  {errors.root.message}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={requestClose}
                disabled={pending}
                className={secondaryClass}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={!canEdit || pending || (!isDirty && !avatarChanged)}
                className={`${primaryClass} inline-flex items-center gap-2`}
              >
                {pending && (
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {pending ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </form>

          {open && cropSource && (
            <AvatarCropDialog
              file={cropSource}
              returnFocusRef={avatarButtonRef}
              onCancel={() => setCropSource(null)}
              onConfirm={(cropped) => {
                setFile(cropped);
                setAvatarRemoved(false);
                setAvatarError("");
                uploadedAvatar.current = null;
                setCropSource(null);
              }}
            />
          )}

          <Dialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/60" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-[111] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  closeButtonRef.current?.focus();
                }}
              >
                <Dialog.Title className="text-lg font-semibold text-ink">
                  Bỏ thay đổi chưa lưu?
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-ink-muted">
                  Các thay đổi hồ sơ của bạn chưa được lưu.
                </Dialog.Description>
                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setDiscardOpen(false)}
                    className={secondaryClass}
                  >
                    Tiếp tục sửa
                  </button>
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Bỏ thay đổi
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
