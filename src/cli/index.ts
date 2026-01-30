#!/usr/bin/env node
import { createProgram } from "./coco.js";

const program = createProgram();
program.parse(process.argv);
