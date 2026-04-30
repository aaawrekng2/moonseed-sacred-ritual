-- Phase 9.5b: Custom Decks (Stamp AS)

-- ---------------------------------------------------------------
-- custom_decks
-- ---------------------------------------------------------------
CREATE TABLE public.custom_decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  shape TEXT NOT NULL CHECK (shape IN ('rectangle','square','round')),
  width_inches NUMERIC(4,2),
  height_inches NUMERIC(4,2),
  corner_radius_percent INTEGER NOT NULL DEFAULT 4 CHECK (corner_radius_percent >= 0 AND corner_radius_percent <= 30),
  card_back_url TEXT,
  card_back_thumb_url TEXT,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_decks_user ON public.custom_decks(user_id);
CREATE UNIQUE INDEX idx_custom_decks_one_active_per_user
  ON public.custom_decks(user_id) WHERE is_active = true;

ALTER TABLE public.custom_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_decks" ON public.custom_decks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_decks" ON public.custom_decks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_decks" ON public.custom_decks
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_delete_own_decks" ON public.custom_decks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- custom_deck_cards
-- ---------------------------------------------------------------
CREATE TABLE public.custom_deck_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.custom_decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  card_id INTEGER NOT NULL CHECK (card_id >= 0 AND card_id <= 77),
  display_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  display_path TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deck_id, card_id)
);

CREATE INDEX idx_custom_deck_cards_deck ON public.custom_deck_cards(deck_id);
CREATE INDEX idx_custom_deck_cards_user ON public.custom_deck_cards(user_id);

ALTER TABLE public.custom_deck_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_deck_cards" ON public.custom_deck_cards
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_deck_cards" ON public.custom_deck_cards
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_deck_cards" ON public.custom_deck_cards
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_delete_own_deck_cards" ON public.custom_deck_cards
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_custom_decks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_custom_decks_touch
  BEFORE UPDATE ON public.custom_decks
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_decks_updated_at();

CREATE TRIGGER trg_custom_deck_cards_touch
  BEFORE UPDATE ON public.custom_deck_cards
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_decks_updated_at();

-- ---------------------------------------------------------------
-- Storage bucket: custom-deck-images (private)
-- ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('custom-deck-images', 'custom-deck-images', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "users_read_own_deck_images" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'custom-deck-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users_upload_own_deck_images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'custom-deck-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users_update_own_deck_images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'custom-deck-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users_delete_own_deck_images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'custom-deck-images' AND auth.uid()::text = (storage.foldername(name))[1]);
