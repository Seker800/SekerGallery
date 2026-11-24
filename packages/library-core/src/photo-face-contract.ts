export const PHOTO_FACE_MODEL_VERSION = 'yunet-2023mar-sface-2021dec-v1';
/** Automatic assignment: nearest existing prototype must clear this similarity. */
export const PHOTO_FACE_AUTO_MERGE_THRESHOLD = 0.45;
/** Manual review only surfaces plausible splits; named people merge explicitly. */
export const PHOTO_FACE_REVIEW_MIN_SIMILARITY = 0.3;
export const PHOTO_FACE_REVIEW_SAMPLE_LIMIT = 3;
/** New confirmed faces move the prototype gradually instead of freezing the first sample. */
export const PHOTO_FACE_PROTOTYPE_BLEND = 0.2;
