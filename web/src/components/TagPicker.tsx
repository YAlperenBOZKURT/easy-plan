import { useMemo, useState } from 'react';
import { addTag, MAX_CARD_TAGS, MAX_TAG_LENGTH, tagColorIndex } from '../lib/tags.ts';

export default function TagPicker({
  value,
  suggestions,
  onChange,
}: {
  value: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const available = useMemo(() => {
    const query = input.trim().toLocaleLowerCase('tr-TR');
    return suggestions
      .filter((tag) => !value.some((selected) => selected.toLocaleLowerCase('tr-TR') === tag.toLocaleLowerCase('tr-TR')))
      .filter((tag) => query.length === 0 || tag.toLocaleLowerCase('tr-TR').includes(query))
      .slice(0, 6);
  }, [input, suggestions, value]);

  const commit = (tag: string) => {
    const result = addTag(value, tag);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChange(result.tags);
    setInput('');
    setError('');
  };

  return (
    <div className="field tag-picker">
      <div className="tag-heading">
        <label className="label" htmlFor="tag-input">Etiketler</label>
        <span className="hint">{value.length}/{MAX_CARD_TAGS}</span>
      </div>
      {value.length > 0 && (
        <div className="tag-list">
          {value.map((tag) => (
            <span className={`tag-chip tag-color-${tagColorIndex(tag)}`} key={tag}>
              {tag}
              <button
                type="button"
                aria-label={`${tag} etiketini kaldır`}
                onClick={() => onChange(value.filter((current) => current !== tag))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input-row">
        <input
          id="tag-input"
          value={input}
          maxLength={MAX_TAG_LENGTH}
          disabled={value.length >= MAX_CARD_TAGS}
          placeholder="Etiket yaz ve Enter'a bas"
          onChange={(event) => {
            setInput(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ',') return;
            event.preventDefault();
            commit(input);
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={value.length >= MAX_CARD_TAGS || input.trim().length === 0}
          onClick={() => commit(input)}
        >
          Ekle
        </button>
      </div>
      {available.length > 0 && (
        <div className="tag-suggestions" aria-label="Etiket önerileri">
          {available.map((tag) => (
            <button type="button" key={tag} onClick={() => commit(tag)}>
              + {tag}
            </button>
          ))}
        </div>
      )}
      {error && <span className="error-text" role="alert">{error}</span>}
    </div>
  );
}
