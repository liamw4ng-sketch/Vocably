CREATE TABLE "cefr_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"term_normalized" text NOT NULL,
	"term" text NOT NULL,
	"pos" text NOT NULL,
	"level" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cefr_levels_term_pos_idx" ON "cefr_levels" USING btree ("term_normalized","pos");