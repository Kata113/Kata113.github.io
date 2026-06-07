#include <emscripten/bind.h>
#include <sstream>
#include "quiz_engine.h"

static QuizEngine engine;

void loadDictionary(const std::string& dictContent) {
    std::vector<std::string> words;
    std::stringstream ss(dictContent);
    std::string line;
    while (std::getline(ss, line)) {
        // Trim whitespace and carriage returns
        line.erase(0, line.find_first_not_of(" \t\r\n"));
        line.erase(line.find_last_not_of(" \t\r\n") + 1);
        if (!line.empty()) {
            words.push_back(line);
        }
    }
    engine.loadDictionary(words);
}

void generateQuiz(int type, const std::string& poolContent, int order) {
    std::vector<std::string> pool;
    std::stringstream ss(poolContent);
    std::string word;
    while (ss >> word) {
        // Trim word
        word.erase(0, word.find_first_not_of(" \t\r\n"));
        word.erase(word.find_last_not_of(" \t\r\n") + 1);
        if (!word.empty()) {
            pool.push_back(word);
        }
    }
    engine.generateQuiz(type, pool, order);
}

std::string getCurrentQuestionJson() {
    return engine.getCurrentQuestionJson();
}

bool submitAnswer(const std::string& answer) {
    return engine.submitAnswer(answer);
}

std::string checkAnswers() {
    return engine.checkAnswers();
}

bool nextQuestion() {
    return engine.nextQuestion();
}

std::string getProgressJson() {
    return engine.getProgressJson();
}

void restoreProgress(int questionIndex, int totalCorrectVal, int totalMissedVal, int totalIncorrectVal, int fullyCorrectVal, const std::string& userCorrectContent, const std::string& userIncorrectContent, bool checked) {
    std::vector<std::string> userCorrect;
    std::stringstream ss(userCorrectContent);
    std::string w;
    while (ss >> w) {
        userCorrect.push_back(w);
    }
    
    std::vector<std::string> userIncorrect;
    std::stringstream ss2(userIncorrectContent);
    while (ss2 >> w) {
        userIncorrect.push_back(w);
    }
    
    engine.restoreProgress(questionIndex, totalCorrectVal, totalMissedVal, totalIncorrectVal, fullyCorrectVal, userCorrect, userIncorrect, checked);
}

EMSCRIPTEN_BINDINGS(quiz_module) {
    emscripten::function("loadDictionary", &loadDictionary);
    emscripten::function("generateQuiz", &generateQuiz);
    emscripten::function("getCurrentQuestionJson", &getCurrentQuestionJson);
    emscripten::function("submitAnswer", &submitAnswer);
    emscripten::function("checkAnswers", &checkAnswers);
    emscripten::function("nextQuestion", &nextQuestion);
    emscripten::function("getProgressJson", &getProgressJson);
    emscripten::function("restoreProgress", &restoreProgress);
}
