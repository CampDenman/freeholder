// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useState } from "react";
import { Crosshair } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/ui/primitives";
import { setFocalPointAction } from "../../media-actions";

export function FocalPointForm({
  id,
  initialX,
  initialY,
  labels,
}: {
  id: string;
  initialX: number;
  initialY: number;
  labels: { heading: string; x: string; y: string; save: string };
}) {
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  return (
    <form action={setFocalPointAction} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-2 text-xs font-semibold text-ink">
        <Crosshair size={15} weight="bold" />
        {labels.heading}
      </div>
      <label className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-xs text-ink-muted">
        <span>{labels.x}</span>
        <input
          type="range"
          name="x"
          min={0}
          max={10000}
          step={100}
          value={x}
          onChange={(event) => setX(Number(event.target.value))}
          className="accent-accent"
        />
        <span className="text-end font-mono tabular-nums">{Math.round(x / 100)}%</span>
      </label>
      <label className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-xs text-ink-muted">
        <span>{labels.y}</span>
        <input
          type="range"
          name="y"
          min={0}
          max={10000}
          step={100}
          value={y}
          onChange={(event) => setY(Number(event.target.value))}
          className="accent-accent"
        />
        <span className="text-end font-mono tabular-nums">{Math.round(y / 100)}%</span>
      </label>
      <div>
        <Button type="submit" variant="quiet">
          {labels.save}
        </Button>
      </div>
    </form>
  );
}
