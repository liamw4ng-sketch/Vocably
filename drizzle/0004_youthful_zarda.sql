-- Orden a propósito: ADD COLUMN primero y DROP INDEX justo antes del CREATE
-- UNIQUE INDEX que lo sustituye, para que un fallo a mitad deje el índice
-- viejo en pie en vez de dejar "terms" sin ningún índice único.
ALTER TABLE "terms" ADD COLUMN "sense_hint" text DEFAULT '' NOT NULL;--> statement-breakpoint
DROP INDEX "terms_term_normalized_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "terms_term_normalized_idx" ON "terms" USING btree ("term_normalized","sense_hint");
