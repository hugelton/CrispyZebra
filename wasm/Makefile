EMCC ?= emcc

CXXFLAGS := -O3 -std=c++17 -I..
EMFLAGS := -s WASM=1 -s MODULARIZE=0 -s 'EXPORTED_RUNTIME_METHODS=[]' -s ALLOW_MEMORY_GROWTH=1

.PHONY: all clean

all: crispy_zebra.js crispy_zebra.wasm

crispy_zebra.js crispy_zebra.wasm: crispy_zebra_wasm.cpp ../CrispyZebra.h
	$(EMCC) crispy_zebra_wasm.cpp $(CXXFLAGS) $(EMFLAGS) -o crispy_zebra.js

clean:
	rm -f crispy_zebra.js crispy_zebra.wasm
