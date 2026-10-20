-- Optional profile details; existing profiles retain NULL values.
ALTER TABLE profiles
  ADD COLUMN home_city text,
  ADD COLUMN website text,
  ADD CONSTRAINT profiles_home_city_length CHECK (home_city IS NULL OR char_length(home_city) <= 120),
  ADD CONSTRAINT profiles_website_length CHECK (website IS NULL OR char_length(website) <= 2048);
