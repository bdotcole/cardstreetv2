-- Add address and contact fields to profiles table for Flash Express integration
ALTER TABLE profiles
ADD COLUMN address TEXT,
ADD COLUMN district TEXT,
ADD COLUMN state TEXT,
ADD COLUMN province TEXT,
ADD COLUMN postcode TEXT,
ADD COLUMN phone_number TEXT;
