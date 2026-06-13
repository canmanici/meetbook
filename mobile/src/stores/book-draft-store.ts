import { create } from 'zustand';

interface BookDraftState {
  pickedLocation: { lat: number; lng: number } | null;
  setPickedLocation: (location: { lat: number; lng: number }) => void;
  clearPickedLocation: () => void;
  scannedISBN: string | null;
  setScannedISBN: (isbn: string) => void;
  clearScannedISBN: () => void;
}

export const useBookDraftStore = create<BookDraftState>((set) => ({
  pickedLocation: null,
  setPickedLocation: (location) => set({ pickedLocation: location }),
  clearPickedLocation: () => set({ pickedLocation: null }),
  scannedISBN: null,
  setScannedISBN: (isbn) => set({ scannedISBN: isbn }),
  clearScannedISBN: () => set({ scannedISBN: null }),
}));
