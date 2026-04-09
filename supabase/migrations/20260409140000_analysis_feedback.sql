-- Add analysis feedback to user_breaks (asked during break completion)
ALTER TABLE user_breaks
  ADD COLUMN analysis_feedback TEXT CHECK (analysis_feedback IN ('helpful', 'not_helpful'));
