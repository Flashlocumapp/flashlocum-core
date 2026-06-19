CREATE OR REPLACE FUNCTION public._hhmm_to_min(_s text)
RETURNS int LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  s text;
  is_pm boolean := false;
  is_am boolean := false;
  hh int;
  mm int;
BEGIN
  IF _s IS NULL THEN RETURN 0; END IF;
  s := upper(btrim(_s));
  IF s = '' THEN RETURN 0; END IF;
  IF s LIKE '%AM' THEN
    is_am := true;
    s := btrim(left(s, length(s) - 2));
  ELSIF s LIKE '%PM' THEN
    is_pm := true;
    s := btrim(left(s, length(s) - 2));
  END IF;
  -- Now s should be like 'HH:MM' or 'H:MM'
  hh := (split_part(s, ':', 1))::int;
  mm := COALESCE(NULLIF(split_part(s, ':', 2), ''), '0')::int;
  IF is_am OR is_pm THEN
    -- 12-hour clock normalization
    IF hh = 12 THEN hh := 0; END IF;
    IF is_pm THEN hh := hh + 12; END IF;
  END IF;
  RETURN hh * 60 + mm;
END $$;