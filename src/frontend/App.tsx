import React, { useEffect, useState } from "react";
import Markdown from 'react-markdown';
import { useAppKit } from "@mchen-lab/app-kit/frontend";
import { Layout } from "./components/Layout";
import { StatusCard } from "./components/StatusCard";
import { Card, CardContent } from "./components/ui/card";

function App() {
  const { version, loading, error } = useAppKit();
  const [docs, setDocs] = useState<string>("");

  useEffect(() => {
    fetch("/api/docs")
      .then(res => res.json())
      .then(data => setDocs(data.content || ""))
      .catch(() => setDocs("Failed to load documentation."));
  }, []);

  return (
    <Layout>
      <StatusCard 
        port="31171"
        items={[
          { label: "Version", value: version?.version || "..." },
          { label: "Commit", value: version?.commit || "..." }
        ]}
      />

      <div className="grid gap-6 grid-cols-1">
        <Card>
          <CardContent className="p-6 md:p-10">
            <article className="prose prose-slate max-w-none">
              <Markdown>{docs}</Markdown>
            </article>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

export default App;
