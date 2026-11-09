"use client";

import { useRef, useState } from "react";
import { FileSearch, Search, X } from "lucide-react";
import { categories, documents } from "../catalog";
import { DocumentRow } from "../ui";

export function DocSearch() {
  const searchInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [query, setQuery] = useState("");
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = documents.filter((document) => {
    const fields = [document.title, document.description, document.category, document.source].join(" ").toLocaleLowerCase();
    return (category === "全部" || document.category === category) && tokens.every((token) => fields.includes(token));
  });

  function clear() {
    setQuery("");
    searchInput.current?.focus();
  }

  function reset() {
    setCategory("全部");
    clear();
  }

  return (
    <>
      <div className="search-box" role="search" aria-label="搜索文档资料">
        <Search size={19} aria-hidden />
        <label htmlFor="document-search" className="sr-only">搜索标题、文件名或关键词</label>
        <input ref={searchInput} id="document-search" type="search" placeholder="搜索标题、文件名或关键词" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清空搜索" className="clear-search" onClick={clear}><X size={18} aria-hidden /></button>}
      </div>
      <div className="filters">
        <div role="group" aria-label="文档分类" className="filter-group">
          {categories.map((value) => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}
        </div>
        <p role="status">{results.length} 份资料</p>
      </div>
      {results.length ? (
        <ul className="card doc-list">{results.map((document) => <DocumentRow key={document.id} document={document} />)}</ul>
      ) : (
        <div className="card empty">
          <FileSearch size={25} aria-hidden /><h2>没有符合条件的资料</h2>
          <p>可以换一个关键词，或查看全部分类。</p>
          <button type="button" className="button button-secondary" onClick={reset}>重置搜索和分类</button>
        </div>
      )}
    </>
  );
}


