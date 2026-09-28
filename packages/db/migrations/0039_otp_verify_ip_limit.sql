-- =====================================================================
--  81. A CEILING ON WHERE THE GUESSES COME FROM, NOT ONLY WHAT THEY HIT
--
--  `otp.verify` was the one auth route that limited the target without
--  limiting the source. Ten guesses per phone number per fifteen minutes is
--  ten guesses each for somebody working through a list of numbers, and
--  nothing on the route itself counted how many came from one address.
--
--  `otp.send` on `ip` already bounds how many codes one address can cause to
--  be SENT, which covers most of the path — but not guessing at codes that
--  somebody else's request created, which is the case this closes.
--
--  30 in the same fifteen-minute window: three times the per-number
--  allowance, so a real person — who gets one code and types it — is nowhere
--  near it, while a spray across numbers from one address stops after thirty.
--  Seeded rather than left to the code fallback so it can be loosened during
--  an incident without a deploy, like every other policy in this table.
-- =====================================================================

INSERT INTO rate_limit_policies (code, description, scope, window_seconds, max_requests) VALUES
  ('otp.verify', 'Code guesses from one address', 'ip', 900, 30)
ON CONFLICT (code, scope, plan_id) DO NOTHING;
