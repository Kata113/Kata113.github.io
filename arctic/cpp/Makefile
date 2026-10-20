EMCC = /home/kata/emsdk/upstream/emscripten/em++
FLAGS = --bind -O2 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1

all: ../arctic_cpp_engine.js

../arctic_cpp_engine.js: quiz_engine.cpp bindings.cpp quiz_engine.h
	$(EMCC) quiz_engine.cpp bindings.cpp -o ../arctic_cpp_engine.js $(FLAGS)

clean:
	rm -f ../arctic_cpp_engine.js ../arctic_cpp_engine.wasm
