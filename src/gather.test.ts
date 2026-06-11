import { test } from "node:test";
import assert from "node:assert/strict";
import { exposesMain } from "./gather.js";

// Regression tests for example detection (issue #2): examples that expose
// `main` should be eligible regardless of how the exposing list is formatted.
test("exposesMain: eligible modules", () => {
  const eligible = [
    "module Main exposing (main)\n\nmain = 1",
    "module Main exposing (..)\n\nmain = 1",
    "module Main exposing (Model, Msg, main, view)\n",
    // multi-line exposing list as produced by elm-format
    "module Main exposing\n    ( main\n    , view\n    )\n",
    "module Main exposing\n    ( view\n    , update\n    , main\n    )\n",
    // dotted module name
    "module Pages.Home exposing (main)\n",
    "port module Main exposing (main)\n",
    "{-| docs -}\nmodule Main exposing (main)\n",
    "module Main exposing\n    (..)\n",
  ];
  for (const source of eligible) {
    assert.equal(exposesMain(source), true, `should be eligible:\n${source}`);
  }
});

test("exposesMain: ineligible modules", () => {
  const ineligible = [
    "module Util exposing (helper)\n\nhelper = 1",
    // must match `main` as a whole word, not a substring like `maintain`
    "module Util exposing (maintain)\n",
    "helper = 1\n",
  ];
  for (const source of ineligible) {
    assert.equal(
      exposesMain(source),
      false,
      `should be ineligible:\n${source}`,
    );
  }
});
