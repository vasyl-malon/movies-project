"use client";
import { createContext, useContext } from "react";
export const CurrentUserContext = createContext<string | null>(null);
export function useCurrentUser() {
  const id = useContext(CurrentUserContext);
  if (!id) throw new Error("A verified current user is required");
  return id;
}
