EMCC ?= emcc
SAMPLE_RATE ?= 44100

CXXFLAGS := -O3 -std=c++17 -I.. -DCRISPY_ZEBRA_DEFAULT_SAMPLE_RATE=$(SAMPLE_RATE)u
EMFLAGS := -s WASM=1 -s MODULARIZE=0 -s 'EXPORTED_RUNTIME_METHODS=[]' -s ALLOW_MEMORY_GROWTH=1

.PHONY: all clean

all: sample_rate_config.js crispy_zebra.js crispy_zebra.wasm

sample_rate_config.js:
	printf 'window.CRISPY_ZEBRA_SAMPLE_RATE = %s;\ndocument.documentElement.dataset.sampleRate = "%s";\n' '$(SAMPLE_RATE)' '$(SAMPLE_RATE)' > $@

crispy_zebra.js crispy_zebra.wasm: crispy_zebra_wasm.cpp ../CrispyZebra.h
	$(EMCC) crispy_zebra_wasm.cpp $(CXXFLAGS) $(EMFLAGS) -o crispy_zebra.js

clean:
	rm -f crispy_zebra.js crispy_zebra.wasm sample_rate_config.js
