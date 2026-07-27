#ifndef QUIZ_ENGINE_H
#define QUIZ_ENGINE_H

#include <string>
#include <vector>
#include <unordered_set>
#include <unordered_map>
#include <algorithm>

enum QuizType {
    QuizAnagrams = 0,
    QuizAnagramsWithHooks = 1,
    QuizBuild = 2
};

enum QuestionOrder {
    AlphabeticalOrder = 0,
    RandomOrder = 1,
    ProbabilityOrder = 2,
    PreserveOrder = 3
};

struct QuizQuestion {
    std::string questionText;           // Displayed text (alphagram or base word)
    std::vector<std::string> answers;   // List of anagrams/builds
    std::vector<std::string> frontHooks;// Front hooks for each answer
    std::vector<std::string> backHooks; // Back hooks for each answer
};

class QuizEngine {
public:
    QuizEngine();
    
    void loadDictionary(const std::vector<std::string>& words);
    void generateQuiz(int type, const std::vector<std::string>& pool, int order);
    
    std::string getCurrentQuestionJson() const;
    bool submitAnswer(const std::string& answer);
    std::string checkAnswers(); // Ends current question, returns checked state JSON, counts misses
    bool nextQuestion();
    std::string getProgressJson() const;
    void restoreProgress(int questionIndex, int totalCorrectVal, int totalMissedVal, int totalIncorrectVal, int fullyCorrectVal, const std::vector<std::string>& userCorrect, const std::vector<std::string>& userIncorrect, bool checked);
    
private:
    std::string getAlphagram(const std::string& word) const;
    double getProbabilityScore(const std::string& alphagram) const;
    void computeHooks(const std::string& word, std::string& front, std::string& back) const;

    std::unordered_set<std::string> fullDictionary;
    std::unordered_map<std::string, std::vector<std::string>> alphagramToWords;
    
    std::vector<QuizQuestion> questions;
    int currentQuestionIndex;
    bool currentQuestionChecked;
    
    // Tracking current question state
    std::unordered_set<std::string> correctAnswersSet; // Set of all correct answers
    std::unordered_set<std::string> userCorrectAnswers; // Answers user got right
    std::unordered_set<std::string> userIncorrectAnswers; // Answers user got wrong
    
    // Overall quiz statistics
    int totalQuestions;
    int totalCorrect;
    int totalMissed;
    int totalIncorrect;
    int quizType;
    int fullyCorrectQuestions;
};

#endif // QUIZ_ENGINE_H
