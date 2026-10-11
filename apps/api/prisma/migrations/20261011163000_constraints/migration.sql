-- Data integrity constraints that Prisma cannot express declaratively
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_minutes_positive" CHECK ("minutes" > 0 AND "minutes" <= 1440);
ALTER TABLE "BusinessHours" ADD CONSTRAINT "BusinessHours_day_range" CHECK ("dayOfWeek" BETWEEN 1 AND 7);
ALTER TABLE "BusinessHours" ADD CONSTRAINT "BusinessHours_window" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute");
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_positive_targets" CHECK ("firstResponseMinutes" > 0 AND "resolutionMinutes" >= "firstResponseMinutes" AND "warningThresholdPercent" BETWEEN 1 AND 99);
ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_not_self" CHECK ("sourceId" <> "targetId");
-- Fast case-insensitive search on subject
CREATE INDEX "Ticket_subject_lower_idx" ON "Ticket" (lower("subject"));
