import React, { createContext, useContext, useState } from "react";

interface InputLockContextValue {
  inputLocked: boolean;
  setInputLocked: (locked: boolean) => void;
}

const InputLockContext = createContext<InputLockContextValue | null>(null);

export function InputLockProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [inputLocked, setInputLocked] = useState(false);
  return (
    <InputLockContext.Provider value={{ inputLocked, setInputLocked }}>
      {children}
    </InputLockContext.Provider>
  );
}

export function useInputLock(): InputLockContextValue {
  const ctx = useContext(InputLockContext);
  if (!ctx) {
    throw new Error("useInputLock must be used within InputLockProvider");
  }
  return ctx;
}
