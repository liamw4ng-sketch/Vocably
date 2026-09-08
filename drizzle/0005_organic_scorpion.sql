-- Orden a propósito: los ADD COLUMN primero y el DROP el último, para que un
-- fallo a mitad deje la tabla con columnas de más y no con ajustes de menos.
ALTER TABLE "settings" ADD COLUMN "session_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "session_mode" text DEFAULT 'mezcla' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "reviews_per_session";