CREATE TABLE "dictionary_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"term_normalized" text NOT NULL,
	"term" text NOT NULL,
	"pos" text NOT NULL,
	"gloss" text NOT NULL,
	"example" text,
	"translations" text[] DEFAULT '{}' NOT NULL,
	"translation_source" text
);
--> statement-breakpoint
CREATE INDEX "dictionary_entries_term_normalized_idx" ON "dictionary_entries" USING btree ("term_normalized");