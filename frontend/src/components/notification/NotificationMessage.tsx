import type { NotificationItem } from "@/types";

const VERB: Record<NotificationItem["type"], string> = {
  like: "đã thích bài viết của bạn",
  comment: "đã bình luận về bài viết của bạn",
  follow: "đã theo dõi bạn",
};

const name = (displayName: string) => <strong className="font-semibold text-ink">{displayName}</strong>;

/**
 * 1 person:  "A đã thích bài viết của bạn"
 * 2 people:  "A và B đã thích bài viết của bạn"
 * 3+ people: "A và 2 người khác đã thích bài viết của bạn"   (n = total people - 1)
 */
export function NotificationMessage({ item }: { item: Pick<NotificationItem, "type" | "actors" | "actor_count"> }) {
  const [first, second] = item.actors;
  const total = item.actor_count;

  let subject: React.ReactNode;
  if (!first) subject = <>Ai đó</>;
  else if (total <= 1) subject = name(first.display_name);
  else if (total === 2 && second) subject = <>{name(first.display_name)} và {name(second.display_name)}</>;
  else subject = <>{name(first.display_name)} và {total - 1} người khác</>;

  return (
    <span>
      {subject} {VERB[item.type]}
    </span>
  );
}