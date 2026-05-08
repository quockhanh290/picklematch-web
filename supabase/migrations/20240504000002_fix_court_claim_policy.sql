-- Fix: Allow owners to claim unowned courts
-- The previous policy only allowed updates if the user was already the owner.
-- This new policy allows an update if the court currently has no owner.

DROP POLICY IF EXISTS "Owners can update their own courts" ON courts;

-- 1. Policy for claiming: Allow update if owner_id is NULL, and new owner_id must be the user
CREATE POLICY "Allow claiming unowned courts"
ON courts FOR UPDATE
TO authenticated
USING (owner_id IS NULL)
WITH CHECK (owner_id = auth.uid());

-- 2. Policy for managing: Allow update if user is already the owner
CREATE POLICY "Owners can manage their own courts"
ON courts FOR UPDATE
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());
