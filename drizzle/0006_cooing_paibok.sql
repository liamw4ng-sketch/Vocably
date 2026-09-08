CREATE TABLE "spanish_meanings" (
	"id" serial PRIMARY KEY NOT NULL,
	"term_normalized" text NOT NULL,
	"term" text NOT NULL,
	"pos" text NOT NULL,
	"meanings" text[] DEFAULT '{}' NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spanish_meanings_term_pos_idx" ON "spanish_meanings" USING btree ("term_normalized","pos");