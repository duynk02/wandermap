import { registerDecorator, ValidationOptions } from 'class-validator';

export function isManagedMediaUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(url.pathname);
  } catch { return false; }
}

/** Legacy URLs remain readable in development; new production Posts/Journeys use managed assets only. */
export function IsManagedMediaUrl(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => registerDecorator({
    name: 'managedMediaUrl', target: object.constructor, propertyName: String(propertyName), options,
    validator: { validate: (input: unknown) => process.env.NODE_ENV !== 'production' || isManagedMediaUrl(input),
      defaultMessage: () => 'Ảnh phải được tải lên qua WanderMap.' },
  });
}
