CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"new_cards_per_day" integer DEFAULT 20 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_states" ADD COLUMN "learning_steps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "answer_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_logs_answer_id_idx" ON "review_logs" USING btree ("answer_id");