DROP INDEX "terms_term_normalized_idx";--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "sense_hint" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "terms_term_normalized_idx" ON "terms" USING btree ("term_normalized","sense_hint");