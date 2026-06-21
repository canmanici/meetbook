import React from "react";
import { render } from "@testing-library/react-native";
import MarkerPreviewCard from "../marker-preview-card";

describe("MarkerPreviewCard", () => {
  const mockBook = {
    id: "book-1",
    title: "Suç ve Ceza",
    author: "Dostoyevski",
    coverUrl: null,
    distanceKm: 2.5,
    ownerName: "Ahmet",
    isFavorited: false,
  };

  it("renders book information", () => {
    const { getByText } = render(
      <MarkerPreviewCard book={mockBook} />
    );
    expect(getByText("Suç ve Ceza")).toBeTruthy();
    expect(getByText("Dostoyevski")).toBeTruthy();
    expect(getByText("2.5 km")).toBeTruthy();
    expect(getByText("Ahmet")).toBeTruthy();
  });

  it("shows Takas İste button", () => {
    const { getByText } = render(
      <MarkerPreviewCard book={mockBook} />
    );
    expect(getByText("Takas İste")).toBeTruthy();
  });
});
