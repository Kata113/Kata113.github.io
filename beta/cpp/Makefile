EMCC = /home/kata/emsdk/upstream/emscripten/em++
FLAGS = --bind -O2 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1

all: ../zyzzylu_cpp_engine.js

../zyzzylu_cpp_engine.js: quiz_engine.cpp bindings.cpp quiz_engine.h
	$(EMCC) quiz_engine.cpp bindings.cpp -o ../zyzzylu_cpp_engine.js $(FLAGS)

clean:
	rm -f ../zyzzylu_cpp_engine.js ../zyzzylu_cpp_engine.wasm
