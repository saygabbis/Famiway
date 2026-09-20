import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Search } from "lucide-react";

type Props = {
  onOpen: (value: string) => Promise<void>;
  busy: boolean;
  error: string;
};

export default function Home({ onOpen, busy, error }: Props) {
  const [value, setValue] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onOpen(value);
  }

  return (
    <motion.section
      className="home"
      initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.form className="composer" onSubmit={submit} whileTap={{ scale: 0.995 }}>
        <Search size={18} strokeWidth={1.75} className="composer-icon" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Cole o link da pasta do Drive"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Link da pasta do Google Drive"
        />
        <button className="composer-go" type="submit" disabled={busy || !value.trim()} aria-label="Abrir pasta">
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </motion.form>
      {error ? <p className="error">{error}</p> : null}
    </motion.section>
  );
}
